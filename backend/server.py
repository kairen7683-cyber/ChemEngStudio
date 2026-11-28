"""ChemEng Studio — Multi-User Authenticated FastAPI Backend & Static Host.

Provides:
- Closed invite-only / admin-approval / open user registration & PBKDF2 password hashing
- HttpOnly session cookies + SQLite WAL persistence
- Strict per-user workspace isolation (users only ever read/write their own workspaces)
- Proprietary baseline JSON gating (/data/* requires authenticated session)
- Server-side Gemini AI proxy with per-user daily quota enforcement
- Dual admin control via Web Console or X-Admin-Master-Key header
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional
from urllib.parse import quote

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = (BASE_DIR / "out").resolve()
DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
try:
    os.chmod(DATA_DIR, 0o700)
except OSError:
    pass

DB_PATH = DATA_DIR / "chemeng_studio.db"
CREDS_PATH = DATA_DIR / ".admin_credentials"

SESSION_COOKIE_NAME = "chemplant_session"
SESSION_TTL_DAYS = 14
EPHEMERAL_SESSION_TTL_HOURS = 12
PBKDF2_ITERS = 260_000
MAX_WORKSPACE_BYTES = 5 * 1024 * 1024
MAX_WORKSPACE_KEYS_PER_USER = 50
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MOBILE_UA_RE = re.compile(r"Android|iPhone|iPad|iPod|Mobile|Windows Phone", re.IGNORECASE)
WS_KEY_RE = re.compile(r"^[a-zA-Z0-9_.:-]{1,120}$")

# Simple in-memory sliding IP rate limit for auth attempts
_AUTH_FAIL_LOG: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW_S = 300.0
RATE_LIMIT_MAX_ATTEMPTS = 12


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utcnow().isoformat()


def today_kst_str() -> str:
    kst = utcnow() + timedelta(hours=9)
    return kst.strftime("%Y-%m-%d")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERS)
    return f"pbkdf2_sha256${PBKDF2_ITERS}${salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, iter_s, salt, digest_hex = stored_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iters = int(iter_s)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iters)
        return hmac.compare_digest(dk.hex(), digest_hex)
    except Exception:
        return False


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "").strip()
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_auth_rate_limit(ip: str) -> None:
    now = time.time()
    recent = [t for t in _AUTH_FAIL_LOG.get(ip, []) if now - t < RATE_LIMIT_WINDOW_S]
    _AUTH_FAIL_LOG[ip] = recent
    if len(recent) >= RATE_LIMIT_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="짧은 시간 내 인증 시도가 너무 많습니다. 5분 후 다시 시도하세요.",
        )


def record_auth_failure(ip: str) -> None:
    now = time.time()
    recent = [t for t in _AUTH_FAIL_LOG.get(ip, []) if now - t < RATE_LIMIT_WINDOW_S]
    recent.append(now)
    _AUTH_FAIL_LOG[ip] = recent


def clear_auth_failures(ip: str) -> None:
    _AUTH_FAIL_LOG.pop(ip, None)


def is_https_request(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    if proto:
        return proto == "https"
    return request.url.scheme == "https"


def set_session_cookie(
    response: Response, request: Request, raw_token: str, remember_me: bool = True
) -> None:
    cookie_kwargs: dict[str, Any] = {
        "key": SESSION_COOKIE_NAME,
        "value": raw_token,
        "httponly": True,
        "samesite": "lax",
        "secure": is_https_request(request),
        "path": "/",
    }
    if remember_me:
        cookie_kwargs["max_age"] = SESSION_TTL_DAYS * 86400
    response.set_cookie(**cookie_kwargs)


def clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=is_https_request(request),
    )


@contextmanager
def get_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def parse_user_agent(ua: str) -> tuple[str, str]:
    """Return (device_type, device_label) from a User-Agent string."""
    raw = (ua or "").strip()
    is_mobile = bool(MOBILE_UA_RE.search(raw))
    device_type = "mobile" if is_mobile else "desktop"

    if not raw:
        return device_type, "Unknown · Mobile" if is_mobile else "Unknown · Browser"

    low = raw.lower()
    if "iphone" in low or "ipad" in low or "ipod" in low:
        os_name = "iOS"
    elif "android" in low:
        os_name = "Android"
    elif "windows phone" in low:
        os_name = "Windows Phone"
    elif "windows" in low:
        os_name = "Windows"
    elif "mac os x" in low or "macintosh" in low:
        os_name = "macOS"
    elif "cros" in low:
        os_name = "ChromeOS"
    elif "linux" in low:
        os_name = "Linux"
    else:
        os_name = "Unknown OS"

    if "edg/" in low or "edge/" in low or "edga/" in low or "edgios/" in low:
        browser = "Edge"
    elif "samsungbrowser/" in low:
        browser = "Samsung Internet"
    elif "opr/" in low or "opera" in low:
        browser = "Opera"
    elif "whale/" in low:
        browser = "Whale"
    elif "firefox/" in low or "fxios/" in low:
        browser = "Firefox"
    elif "chrome/" in low or "crios/" in low:
        browser = "Chrome"
    elif "safari/" in low:
        browser = "Safari"
    else:
        browser = "Mobile" if is_mobile else "Browser"

    return device_type, f"{os_name} · {browser}"


def _ensure_column(conn: sqlite3.Connection, table: str, col_def: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
    except sqlite3.OperationalError as exc:
        if "duplicate column name" not in str(exc).lower():
            raise


def init_db() -> str:
    """Initialize SQLite schema and seed admin user + initial invite code if missing.
    Returns the active ADMIN_MASTER_KEY.
    """
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'active',
            daily_ai_count INTEGER NOT NULL DEFAULT 0,
            daily_ai_date TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            last_login_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            ip_addr TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invite_codes (
            code TEXT PRIMARY KEY,
            memo TEXT NOT NULL DEFAULT '',
            max_uses INTEGER NOT NULL DEFAULT 1,
            used_count INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_by INTEGER,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_workspaces (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            workspace_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, workspace_key)
        );

        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS feedback_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT NOT NULL,
            email TEXT DEFAULT '',
            category TEXT NOT NULL DEFAULT 'bug',
            page_path TEXT DEFAULT '',
            device_type TEXT DEFAULT 'desktop',
            lang TEXT DEFAULT 'ko',
            unit_preset TEXT DEFAULT 'METRIC_ENG',
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'new',
            admin_note TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS interop_gap_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL DEFAULT 'bkp',
            unmapped_components TEXT NOT NULL DEFAULT '[]',
            unsupported_blocks TEXT NOT NULL DEFAULT '[]',
            connection_warnings TEXT NOT NULL DEFAULT '[]',
            missing_searches TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS custom_components (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comp_key TEXT UNIQUE NOT NULL,
            name_ko TEXT NOT NULL,
            name_en TEXT NOT NULL,
            formula TEXT NOT NULL,
            cas_no TEXT DEFAULT '',
            smiles TEXT DEFAULT '',
            mw REAL NOT NULL,
            tb_c REAL NOT NULL,
            tm_c REAL DEFAULT 0.0,
            tc_c REAL NOT NULL,
            pc_bar REAL NOT NULL,
            omega REAL NOT NULL,
            rho_l_25 REAL NOT NULL,
            cp_liq_kj_kgk REAL NOT NULL,
            cp_gas_kj_kgk REAL NOT NULL,
            hvap_tb_kj_kg REAL NOT NULL,
            antoine_a REAL NOT NULL,
            antoine_b REAL NOT NULL,
            antoine_c REAL NOT NULL,
            family TEXT DEFAULT 'polar_solvent',
            is_gas_std INTEGER DEFAULT 0,
            source_summary TEXT DEFAULT '',
            calibration_note TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            requested_by_user_id INTEGER,
            requested_by_username TEXT DEFAULT '',
            admin_note TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hub_flowsheets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'general',
            tags_json TEXT NOT NULL DEFAULT '[]',
            thermo_method TEXT NOT NULL DEFAULT 'AUTO',
            unit_count INTEGER NOT NULL DEFAULT 0,
            stream_count INTEGER NOT NULL DEFAULT 0,
            mass_error_pct REAL DEFAULT NULL,
            converged INTEGER NOT NULL DEFAULT 1,
            is_official INTEGER NOT NULL DEFAULT 0,
            preset_id TEXT DEFAULT NULL,
            author_id INTEGER,
            author_name TEXT NOT NULL DEFAULT 'ChemPlant Team',
            flowsheet_json TEXT NOT NULL DEFAULT '',
            views INTEGER NOT NULL DEFAULT 0,
            forks INTEGER NOT NULL DEFAULT 0,
            likes INTEGER NOT NULL DEFAULT 0,
            post_type TEXT NOT NULL DEFAULT 'showcase',
            is_solved INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'published',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hub_replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hub_id INTEGER NOT NULL REFERENCES hub_flowsheets(id) ON DELETE CASCADE,
            author_id INTEGER,
            author_name TEXT NOT NULL DEFAULT 'ChemEng',
            is_official INTEGER NOT NULL DEFAULT 0,
            message TEXT NOT NULL,
            fixed_url TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        """
    )

    _ensure_column(conn, "hub_flowsheets", "post_type TEXT NOT NULL DEFAULT 'showcase'")
    _ensure_column(conn, "hub_flowsheets", "is_solved INTEGER NOT NULL DEFAULT 0")

    # Seed official Process Hub starter cards once if table is empty
    hub_count = conn.execute("SELECT COUNT(*) FROM hub_flowsheets").fetchone()[0]
    if hub_count == 0:
        now_seed = iso_now()
        official_seeds = [
            (
                "LNG Combined-Cycle Power Plant (CCGT: Brayton + Rankine)",
                "30 t/h Ambient Air + 650 kg/h LNG -> 15 barA Compressor -> 1,150°C Combustor -> Gas Turbine (+5.6 MWe) -> HRSG Waste Heat Recovery -> 40 barA / 480°C Steam Turbine (+1.0 MWe).",
                "energy",
                json.dumps(["CCGT", "Gas Turbine", "Steam Turbine", "HRSG", "Brayton", "Rankine"]),
                "PR",
                12,
                12,
                0.0,
                1,
                1,
                "lng_ccgt_power_plant",
                None,
                "ChemPlant Team",
                "",
                now_seed,
                now_seed,
            ),
            (
                "Benzene / Toluene Rigorous Distillation (20-Stage MESH)",
                "Classic equimolar 50/50 Benzene-Toluene binary separation with 20-stage rigorous MESH column, achieving >99.1% overhead purity and full condenser/reboiler duty balance.",
                "separation",
                json.dumps(["Distillation", "MESH", "Benzene", "Toluene", "VLE"]),
                "PR",
                5,
                5,
                0.0,
                1,
                1,
                "textbook_bt_distillation",
                None,
                "ChemPlant Team",
                "",
                now_seed,
                now_seed,
            ),
            (
                "HDA Toluene Hydrodealkylation with Recycle Loop",
                "Toluene + H2 -> Benzene + CH4 reactor loop with flash separator, gas purge/recycle Wegstein tear convergence, and aromatics recovery column.",
                "petrochemical",
                json.dumps(["HDA", "Recycle", "Wegstein", "Reactor", "Aromatics"]),
                "PR",
                9,
                10,
                0.0,
                1,
                1,
                "hda_toluene_benzene_recycle",
                None,
                "ChemPlant Team",
                "",
                now_seed,
                now_seed,
            ),
            (
                "Ethyl Acetate Esterification & Separation (NRTL)",
                "Acetic Acid + Ethanol -> Ethyl Acetate + H2O liquid-phase esterification with NRTL activity coefficient model and downstream distillation recovery.",
                "reaction",
                json.dumps(["Esterification", "NRTL", "Ethyl Acetate", "CSTR"]),
                "NRTL",
                6,
                6,
                0.0,
                1,
                1,
                "ethyl_acetate_esterification",
                None,
                "ChemPlant Team",
                "",
                now_seed,
                now_seed,
            ),
        ]
        conn.executemany(
            """
            INSERT INTO hub_flowsheets (
                title, description, category, tags_json, thermo_method,
                unit_count, stream_count, mass_error_pct, converged, is_official,
                preset_id, author_id, author_name, flowsheet_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            official_seeds,
        )
    conn.execute(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('hub_public_enabled', '1')"
    )

    _ensure_column(conn, "users", "allowed_plants TEXT DEFAULT NULL")
    _ensure_column(conn, "users", "email TEXT DEFAULT ''")
    _ensure_column(conn, "users", "plant_product TEXT DEFAULT ''")
    _ensure_column(conn, "sessions", "device_type TEXT DEFAULT 'desktop'")
    _ensure_column(conn, "sessions", "device_label TEXT DEFAULT ''")
    _ensure_column(conn, "sessions", "last_seen_at TEXT DEFAULT ''")

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users(lower(email)) WHERE email != ''"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_user_device_exp ON sessions(user_id, device_type, expires_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON feedback_items(status, created_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_custom_components_status_created ON custom_components(status, created_at DESC)"
    )

    defaults = {
        "registration_mode": "invite_only",
        "daily_ai_limit": "30",
        "gemini_api_key": os.environ.get("CHEMENG_GEMINI_KEY", "").strip(),
    }
    for k, v in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO system_settings(key, value) VALUES (?, ?)",
            (k, v),
        )

    master_key = os.environ.get("CHEMENG_MASTER_KEY", "").strip()
    if CREDS_PATH.exists():
        for line in CREDS_PATH.read_text(encoding="utf-8").splitlines():
            if line.startswith("ADMIN_MASTER_KEY=") and not master_key:
                master_key = line.split("=", 1)[1].strip()
    if not master_key:
        master_key = secrets.token_hex(24)

    admin_row = conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    seeded_pw: Optional[str] = None
    if not admin_row:
        seeded_pw = os.environ.get("CHEMENG_INITIAL_ADMIN_PW", "").strip() or f"ChemAdmin!{secrets.token_hex(4)}"
        conn.execute(
            """
            INSERT INTO users(username, display_name, password_hash, role, status, created_at)
            VALUES (?, ?, ?, 'admin', 'active', ?)
            """,
            ("admin", "관리자", hash_password(seeded_pw), iso_now()),
        )

    # Create 1 starter closed-test invite code if none exist
    inv_count = conn.execute("SELECT COUNT(*) AS cnt FROM invite_codes").fetchone()["cnt"]
    starter_code = None
    if inv_count == 0:
        starter_code = f"CHEM-{secrets.token_hex(3).upper()}"
        conn.execute(
            """
            INSERT INTO invite_codes(code, memo, max_uses, used_count, is_active, created_at)
            VALUES (?, ?, 10, 0, 1, ?)
            """,
            (starter_code, "초기 지인 폐쇄형 테스트 코드", iso_now()),
        )

    conn.commit()
    conn.close()

    if not CREDS_PATH.exists() or seeded_pw:
        lines = [f"ADMIN_MASTER_KEY={master_key}"]
        if seeded_pw:
            lines.append("INITIAL_ADMIN_USERNAME=admin")
            lines.append(f"INITIAL_ADMIN_PASSWORD={seeded_pw}")
        if starter_code:
            lines.append(f"INITIAL_INVITE_CODE={starter_code}")
        CREDS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    for p in (DB_PATH, CREDS_PATH):
        if p.exists():
            try:
                os.chmod(p, 0o600)
            except OSError:
                pass

    return master_key


ADMIN_MASTER_KEY = init_db()

app = FastAPI(title="ChemEng Studio Backend", docs_url=None, redoc_url=None)


def get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM system_settings WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO system_settings(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def parse_allowed_plants(raw: Any) -> Optional[list[str]]:
    if raw is None:
        return None
    if isinstance(raw, list):
        items = [str(x).strip() for x in raw if isinstance(x, str) and str(x).strip()]
    elif isinstance(raw, str):
        s = raw.strip()
        if not s:
            return None
        try:
            parsed = json.loads(s)
        except Exception:
            return None
        if not isinstance(parsed, list):
            return None
        items = [str(x).strip() for x in parsed if isinstance(x, str) and str(x).strip()]
    else:
        return None
    if not items or "*" in items:
        return None
    deduped: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped or None


def normalize_allowed_plants_for_db(plants: Optional[list[str]]) -> Optional[str]:
    if plants is None:
        return None
    cleaned: list[str] = []
    seen: set[str] = set()
    for p in plants:
        if not isinstance(p, str):
            continue
        val = p.strip()
        if not val:
            continue
        if val == "*":
            return None
        if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", val):
            raise HTTPException(status_code=400, detail=f"유효하지 않은 공장 ID입니다: {val}")
        if val not in seen:
            seen.add(val)
            cleaned.append(val)
    if not cleaned:
        return None
    return json.dumps(cleaned, ensure_ascii=False)


def serialize_user(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    raw_allowed = row["allowed_plants"] if "allowed_plants" in keys else None
    raw_email = row["email"] if "email" in keys else ""
    raw_plant_product = row["plant_product"] if "plant_product" in keys else ""
    return {
        "id": row["id"],
        "username": row["username"],
        "email": raw_email or "",
        "display_name": row["display_name"],
        "plant_product": raw_plant_product or "",
        "role": row["role"],
        "status": row["status"],
        "allowed_plants": parse_allowed_plants(raw_allowed),
        "daily_ai_count": row["daily_ai_count"],
        "last_login_at": row["last_login_at"],
        "created_at": row["created_at"],
    }


def _should_touch_last_seen(last_seen_iso: Optional[str], now_dt: datetime) -> bool:
    if not last_seen_iso:
        return True
    try:
        prev = datetime.fromisoformat(last_seen_iso)
        if prev.tzinfo is None:
            prev = prev.replace(tzinfo=timezone.utc)
        return (now_dt - prev).total_seconds() >= 60.0
    except Exception:
        return True


def resolve_session_user(
    request: Request, conn: sqlite3.Connection, force_touch: bool = False
) -> Optional[sqlite3.Row]:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        return None
    t_hash = hash_token(raw_token)
    now_dt = utcnow()
    now_iso = now_dt.isoformat()
    row = conn.execute(
        """
        SELECT u.*, s.last_seen_at AS _session_last_seen_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
        """,
        (t_hash, now_iso),
    ).fetchone()
    if not row or row["status"] != "active":
        return None
    if force_touch or _should_touch_last_seen(row["_session_last_seen_at"], now_dt):
        conn.execute(
            "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
            (now_iso, t_hash),
        )
    return row


def require_active_user(request: Request) -> sqlite3.Row:
    with get_db() as conn:
        user = resolve_session_user(request, conn)
        if not user:
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        return user


def require_admin_or_master(
    request: Request,
    x_admin_master_key: Optional[str] = Header(default=None, alias="X-Admin-Master-Key"),
) -> Optional[sqlite3.Row]:
    if x_admin_master_key and hmac.compare_digest(x_admin_master_key.strip(), ADMIN_MASTER_KEY):
        return None
    with get_db() as conn:
        user = resolve_session_user(request, conn)
        if not user:
            raise HTTPException(status_code=401, detail="관리자 인증이 필요합니다.")
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="관리자 권한이 없습니다.")
        return user


def create_session_for_user(
    conn: sqlite3.Connection,
    user_id: int,
    request: Request,
    remember_me: bool = True,
    user_role: str = "user",
) -> tuple[str, str, bool]:
    """Create a new session and enforce per-device-type limits.
    Returns (raw_token, device_type, evicted_previous_device).
    """
    now_iso = iso_now()
    ua_raw = request.headers.get("user-agent", "")[:240]
    device_type, device_label = parse_user_agent(ua_raw)

    # Clean up expired sessions for this user first
    conn.execute(
        "DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?",
        (user_id, now_iso),
    )

    # Enforce per-device-type active session limit:
    # - non-admin: max 1 desktop + max 1 mobile
    # - admin: max 5 per device_type (sliding oldest out above 5)
    max_per_type = 5 if user_role == "admin" else 1
    existing_same_type = conn.execute(
        """
        SELECT token_hash
        FROM sessions
        WHERE user_id = ?
          AND COALESCE(NULLIF(device_type, ''), 'desktop') = ?
          AND expires_at > ?
        ORDER BY created_at DESC, token_hash DESC
        """,
        (user_id, device_type, now_iso),
    ).fetchall()

    keep_count = max(0, max_per_type - 1)
    to_evict = [r["token_hash"] for r in existing_same_type[keep_count:]]
    evicted_previous_device = len(to_evict) > 0
    if to_evict:
        placeholders = ",".join("?" for _ in to_evict)
        conn.execute(
            f"DELETE FROM sessions WHERE token_hash IN ({placeholders})",
            to_evict,
        )

    raw_token = secrets.token_urlsafe(32)
    t_hash = hash_token(raw_token)
    ttl = (
        timedelta(days=SESSION_TTL_DAYS)
        if remember_me
        else timedelta(hours=EPHEMERAL_SESSION_TTL_HOURS)
    )
    exp = (utcnow() + ttl).isoformat()
    conn.execute(
        """
        INSERT INTO sessions(
            token_hash, user_id, expires_at, ip_addr, user_agent,
            device_type, device_label, last_seen_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            t_hash,
            user_id,
            exp,
            client_ip(request),
            ua_raw,
            device_type,
            device_label,
            now_iso,
            now_iso,
        ),
    )
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_iso, user_id))
    return raw_token, device_type, evicted_previous_device


# ── Pydantic Models ─────────────────────────────────────────────────────
class LoginPayload(BaseModel):
    username: str
    password: str
    remember_me: bool = True


class RegisterPayload(BaseModel):
    username: str = ""
    email: Optional[str] = None
    password: str
    display_name: str = ""
    plant_product: str = ""
    invite_code: Optional[str] = None
    signup_source: Optional[str] = None
    remember_me: bool = True


class ChangePwPayload(BaseModel):
    current_password: str
    new_password: str


class WorkspacePutPayload(BaseModel):
    payload_json: str


class WorkspaceBatchItem(BaseModel):
    workspace_key: str
    payload_json: str


class WorkspaceBatchPayload(BaseModel):
    items: list[WorkspaceBatchItem] = Field(default_factory=list)


class AdminSettingsPayload(BaseModel):
    registration_mode: Optional[Literal["invite_only", "approval", "open"]] = None
    daily_ai_limit: Optional[int] = None
    gemini_api_key: Optional[str] = None


class AdminCreateUserPayload(BaseModel):
    username: str = ""
    email: Optional[str] = None
    display_name: str = ""
    password: str
    role: Literal["admin", "user"] = "user"
    allowed_plants: Optional[list[str]] = None


class AdminUpdateUserPayload(BaseModel):
    status: Optional[Literal["active", "pending", "disabled"]] = None
    role: Optional[Literal["admin", "user"]] = None
    new_password: Optional[str] = None
    reset_workspace: Optional[bool] = None
    allowed_plants: Optional[list[str]] = None


class AdminCreateInvitePayload(BaseModel):
    code: Optional[str] = None
    memo: str = ""
    max_uses: int = 5
    expires_days: Optional[int] = 30


class AdminToggleInvitePayload(BaseModel):
    is_active: bool


class AiAdvisePayload(BaseModel):
    prompt: str


class FeedbackCreatePayload(BaseModel):
    category: Literal["bug", "calc", "feature", "ux"] = "bug"
    message: str
    page_path: str = ""
    lang: str = "ko"
    unit_preset: str = "METRIC_ENG"
    attachment_name: Optional[str] = None
    attachment_base64: Optional[str] = None


class AdminUpdateFeedbackPayload(BaseModel):
    status: Optional[Literal["new", "in_progress", "done"]] = None
    admin_note: Optional[str] = None


class InteropGapPayload(BaseModel):
    source_type: Literal["bkp", "inp", "xlsx", "property_db_search", "component_search"] = "bkp"
    unmapped_components: list[str] = Field(default_factory=list)
    unsupported_blocks: list[str] = Field(default_factory=list)
    connection_warnings: list[str] = Field(default_factory=list)
    missing_searches: list[str] = Field(default_factory=list)


# ── Health & Auth Endpoints ─────────────────────────────────────────────
@app.get("/api/health")
def api_health():
    return {"status": "ok", "service": "chemeng-studio", "db_exists": DB_PATH.exists()}


@app.get("/api/auth/status")
def api_auth_status(request: Request):
    with get_db() as conn:
        user = resolve_session_user(request, conn)
        reg_mode = get_setting(conn, "registration_mode", "invite_only")
        ai_limit = int(get_setting(conn, "daily_ai_limit", "30") or "30")
        has_gemini = bool(get_setting(conn, "gemini_api_key", "").strip())
        return {
            "authenticated": bool(user),
            "user": serialize_user(user) if user else None,
            "registration_mode": reg_mode,
            "daily_ai_limit": ai_limit,
            "has_server_gemini": has_gemini,
            "local_dev_bypass": False,
        }


@app.get("/api/auth/me")
def api_auth_me(request: Request):
    with get_db() as conn:
        user = resolve_session_user(request, conn, force_touch=True)
        if not user:
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        return {"user": serialize_user(user)}


@app.post("/api/auth/login")
def api_auth_login(payload: LoginPayload, request: Request, response: Response):
    ip = client_ip(request)
    check_auth_rate_limit(ip)
    ident = payload.username.strip()
    if not ident:
        raise HTTPException(status_code=400, detail="이메일 또는 아이디를 입력하세요.")
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT * FROM users
            WHERE lower(username) = lower(?) OR (email != '' AND lower(email) = lower(?))
            LIMIT 1
            """,
            (ident, ident),
        ).fetchone()
        if not row or not verify_password(payload.password, row["password_hash"]):
            record_auth_failure(ip)
            raise HTTPException(status_code=401, detail="아이디(이메일) 또는 비밀번호가 올바르지 않습니다.")
        if row["status"] == "pending":
            raise HTTPException(status_code=403, detail="관리자 승인 대기 중인 계정입니다.")
        if row["status"] != "active":
            raise HTTPException(status_code=403, detail="비활성화(정지)된 계정입니다. 관리자에게 문의하세요.")
        clear_auth_failures(ip)
        raw_token, device_type, evicted_previous_device = create_session_for_user(
            conn,
            row["id"],
            request,
            remember_me=payload.remember_me,
            user_role=row["role"],
        )
        set_session_cookie(response, request, raw_token, remember_me=payload.remember_me)
        refreshed = conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
        return {
            "user": serialize_user(refreshed),
            "device_type": device_type,
            "evicted_previous_device": evicted_previous_device,
        }


def _normalize_username_and_email(
    raw_username: Optional[str], raw_email: Optional[str]
) -> tuple[str, str]:
    email_val = (raw_email or "").strip().lower()
    uname = (raw_username or "").strip()

    if email_val:
        if len(email_val) > 120 or not EMAIL_RE.match(email_val):
            raise HTTPException(status_code=400, detail="올바른 이메일 주소 형식이 아닙니다.")
        if not uname:
            uname = email_val

    if not uname:
        raise HTTPException(status_code=400, detail="이메일 또는 아이디를 입력하세요.")

    if uname != email_val:
        if "@" in uname:
            uname_low = uname.lower()
            if len(uname_low) > 120 or not EMAIL_RE.match(uname_low):
                raise HTTPException(status_code=400, detail="올바른 이메일 주소 형식이 아닙니다.")
            uname = uname_low
            if not email_val:
                email_val = uname_low
        elif not USERNAME_RE.match(uname):
            raise HTTPException(
                status_code=400,
                detail="아이디는 3~32자의 영문·숫자·밑줄(_), 하이픈(-), 점(.)만 가능합니다.",
            )

    return uname, email_val


_NICKNAME_PREFIXES = (
    "ChemEng",
    "ProcessPro",
    "Reflux",
    "Catalyst",
    "Thermo",
    "Distill",
    "Reactor",
    "Pinch",
    "Syngas",
    "Enthalpy",
)


def generate_random_nickname() -> str:
    prefix = _NICKNAME_PREFIXES[secrets.randbelow(len(_NICKNAME_PREFIXES))]
    num = secrets.randbelow(9000) + 1000
    return f"{prefix}_{num}"


def sanitize_nickname(raw: Optional[str]) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    # Never allow email addresses to leak as public nicknames
    if "@" in s:
        s = s.split("@", 1)[0].strip()
    s = re.sub(r"[\r\n\t]+", " ", s)[:32].strip()
    return s


@app.post("/api/auth/register")
def api_auth_register(payload: RegisterPayload, request: Request, response: Response):
    ip = client_ip(request)
    check_auth_rate_limit(ip)
    uname, email_val = _normalize_username_and_email(payload.username, payload.email)
    dname = sanitize_nickname(payload.display_name) or generate_random_nickname()
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 6자 이상이어야 합니다.")

    with get_db() as conn:
        existing_u = conn.execute(
            "SELECT id FROM users WHERE lower(username) = lower(?)",
            (uname,),
        ).fetchone()
        if existing_u:
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")

        if email_val:
            existing_e = conn.execute(
                """
                SELECT id FROM users
                WHERE (email != '' AND lower(email) = lower(?)) OR lower(username) = lower(?)
                """,
                (email_val, email_val),
            ).fetchone()
            if existing_e:
                raise HTTPException(status_code=409, detail="이미 등록된 이메일 주소입니다.")

        reg_mode = get_setting(conn, "registration_mode", "invite_only")
        if reg_mode == "invite_only":
            code = (payload.invite_code or "").strip().upper()
            if not code:
                record_auth_failure(ip)
                raise HTTPException(status_code=400, detail="초대코드를 입력하세요.")
            inv = conn.execute("SELECT * FROM invite_codes WHERE code = ?", (code,)).fetchone()
            if not inv or not inv["is_active"]:
                record_auth_failure(ip)
                raise HTTPException(status_code=403, detail="유효하지 않거나 정지된 초대코드입니다.")
            if inv["used_count"] >= inv["max_uses"]:
                record_auth_failure(ip)
                raise HTTPException(status_code=403, detail="사용 횟수가 만료된 초대코드입니다.")
            if inv["expires_at"] and inv["expires_at"] < iso_now():
                record_auth_failure(ip)
                raise HTTPException(status_code=403, detail="유효기간이 만료된 초대코드입니다.")

            conn.execute(
                "UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?",
                (code,),
            )
            new_status = "active"
            msg = "초대코드 인증이 완료되어 계정이 활성화되었습니다."
        elif reg_mode == "approval":
            new_status = "pending"
            msg = "가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다."
        else:
            new_status = "active"
            msg = "회원가입이 완료되었습니다."

        default_beta_acl = json.dumps(["simulator_only"], ensure_ascii=False)
        plant_prod_val = (payload.plant_product or "").strip()[:120]
        signup_src_val = (payload.signup_source or "").strip()[:80]
        if reg_mode != "invite_only":
            opt_code = (payload.invite_code or "").strip().upper()
            if opt_code:
                opt_inv = conn.execute("SELECT code FROM invite_codes WHERE code = ? AND is_active = 1", (opt_code,)).fetchone()
                if opt_inv:
                    conn.execute("UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?", (opt_code,))
                if not signup_src_val:
                    signup_src_val = f"invite:{opt_code.lower()}"
        if not signup_src_val:
            ref_hdr = (request.headers.get("referer") or "").strip()
            signup_src_val = ref_hdr[:80] if ref_hdr else "direct"
        cur = conn.execute(
            """
            INSERT INTO users(username, email, display_name, plant_product, signup_source, password_hash, role, status, allowed_plants, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?, ?)
            """,
            (
                uname,
                email_val,
                dname,
                plant_prod_val,
                signup_src_val,
                hash_password(payload.password),
                new_status,
                default_beta_acl,
                iso_now(),
            ),
        )
        new_id = cur.lastrowid
        new_user = conn.execute("SELECT * FROM users WHERE id = ?", (new_id,)).fetchone()
        device_type: Optional[str] = None
        evicted_previous_device = False
        if new_status == "active":
            raw_token, device_type, evicted_previous_device = create_session_for_user(
                conn,
                new_id,
                request,
                remember_me=payload.remember_me,
                user_role="user",
            )
            set_session_cookie(response, request, raw_token, remember_me=payload.remember_me)
        clear_auth_failures(ip)
        return {
            "status": new_status,
            "message": msg,
            "user": serialize_user(new_user),
            "device_type": device_type,
            "evicted_previous_device": evicted_previous_device,
        }


@app.post("/api/auth/logout")
def api_auth_logout(request: Request, response: Response):
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if raw_token:
        t_hash = hash_token(raw_token)
        with get_db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (t_hash,))
    clear_session_cookie(response, request)
    return {"ok": True}


@app.get("/api/auth/sessions")
def api_auth_list_sessions(
    request: Request,
    user: sqlite3.Row = Depends(require_active_user),
):
    raw_token = request.cookies.get(SESSION_COOKIE_NAME) or ""
    current_hash = hash_token(raw_token) if raw_token else ""
    now_iso = iso_now()
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT token_hash, device_type, device_label, created_at, last_seen_at, expires_at
            FROM sessions
            WHERE user_id = ? AND expires_at > ?
            ORDER BY created_at DESC
            """,
            (user["id"], now_iso),
        ).fetchall()
    return {
        "sessions": [
            {
                "id": r["token_hash"],
                "device_type": (r["device_type"] or "desktop"),
                "device_label": r["device_label"] or "",
                "created_at": r["created_at"],
                "last_seen_at": r["last_seen_at"] or r["created_at"],
                "expires_at": r["expires_at"],
                "is_current": r["token_hash"] == current_hash,
            }
            for r in rows
        ]
    }


@app.delete("/api/auth/sessions/{session_id}")
def api_auth_revoke_session(
    session_id: str,
    request: Request,
    response: Response,
    user: sqlite3.Row = Depends(require_active_user),
):
    raw_token = request.cookies.get(SESSION_COOKIE_NAME) or ""
    current_hash = hash_token(raw_token) if raw_token else ""
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM sessions WHERE token_hash = ? AND user_id = ?",
            (session_id, user["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if session_id == current_hash:
        clear_session_cookie(response, request)
    return {"ok": True}


@app.post("/api/auth/change-password")
def api_change_password(
    payload: ChangePwPayload,
    user: sqlite3.Row = Depends(require_active_user),
):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="새 비밀번호는 최소 6자 이상이어야 합니다.")
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 일치하지 않습니다.")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(payload.new_password), user["id"]),
        )
    return {"ok": True}


class DeleteAccountPayload(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


@app.post("/api/auth/delete-account")
def api_delete_my_account(
    payload: DeleteAccountPayload,
    request: Request,
    response: Response,
    user: sqlite3.Row = Depends(require_active_user),
):
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="관리자 계정은 자가 탈퇴할 수 없습니다.")
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="비밀번호가 일치하지 않습니다.")
    uid = user["id"]
    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM user_workspaces WHERE user_id = ?", (uid,))
        # 검토 대기 중인 본인 요청 성분은 삭제, 이미 공용 DB로 승격된 물질은 개인식별정보만 익명화
        conn.execute(
            "DELETE FROM custom_components WHERE requested_by_user_id = ? AND status != 'approved'",
            (uid,),
        )
        conn.execute(
            "UPDATE custom_components SET requested_by_user_id = NULL, requested_by_username = '' WHERE requested_by_user_id = ?",
            (uid,),
        )
        conn.execute(
            "UPDATE feedback_items SET user_id = NULL, username = 'deleted_user', contact_email = '' WHERE user_id = ?",
            (uid,),
        )
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
    clear_session_cookie(response, request)
    return {"ok": True}


# ── Per-User Workspace Isolation Endpoints ──────────────────────────────
def _validate_ws_key(workspace_key: str) -> None:
    if not WS_KEY_RE.match(workspace_key):
        raise HTTPException(status_code=400, detail="유효하지 않은 워크스페이스 키 형식입니다.")


def _upsert_workspace(conn: sqlite3.Connection, user_id: int, workspace_key: str, payload_json: str) -> None:
    _validate_ws_key(workspace_key)
    raw_bytes = payload_json.encode("utf-8")
    if len(raw_bytes) > MAX_WORKSPACE_BYTES:
        raise HTTPException(status_code=413, detail="워크스페이스 저장 용량 한도(5MB)를 초과했습니다.")
    exists = conn.execute(
        "SELECT 1 FROM user_workspaces WHERE user_id = ? AND workspace_key = ?",
        (user_id, workspace_key),
    ).fetchone()
    if not exists:
        cnt = conn.execute(
            "SELECT COUNT(*) AS cnt FROM user_workspaces WHERE user_id = ?",
            (user_id,),
        ).fetchone()["cnt"]
        if cnt >= MAX_WORKSPACE_KEYS_PER_USER:
            raise HTTPException(status_code=400, detail="사용자당 저장 키 개수 한도를 초과했습니다.")
    conn.execute(
        """
        INSERT INTO user_workspaces(user_id, workspace_key, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, workspace_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        """,
        (user_id, workspace_key, payload_json, iso_now()),
    )


@app.get("/api/workspaces")
def api_get_workspaces(user: sqlite3.Row = Depends(require_active_user)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT workspace_key, payload_json, updated_at
            FROM user_workspaces
            WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (user["id"],),
        ).fetchall()
        return {
            "items": [
                {
                    "workspace_key": r["workspace_key"],
                    "payload_json": r["payload_json"],
                    "updated_at": r["updated_at"],
                }
                for r in rows
            ]
        }


@app.put("/api/workspaces/{workspace_key}")
def api_put_workspace(
    workspace_key: str,
    payload: WorkspacePutPayload,
    user: sqlite3.Row = Depends(require_active_user),
):
    with get_db() as conn:
        _upsert_workspace(conn, user["id"], workspace_key, payload.payload_json)
    return {"ok": True}


@app.delete("/api/workspaces/{workspace_key}")
def api_delete_workspace(
    workspace_key: str,
    user: sqlite3.Row = Depends(require_active_user),
):
    _validate_ws_key(workspace_key)
    with get_db() as conn:
        conn.execute(
            "DELETE FROM user_workspaces WHERE user_id = ? AND workspace_key = ?",
            (user["id"], workspace_key),
        )
    return {"ok": True}


@app.post("/api/workspaces/batch")
def api_batch_workspaces(
    payload: WorkspaceBatchPayload,
    user: sqlite3.Row = Depends(require_active_user),
):
    with get_db() as conn:
        for item in payload.items:
            _upsert_workspace(conn, user["id"], item.workspace_key, item.payload_json)
    return {"ok": True, "count": len(payload.items)}


# ── Server-Side Gemini AI Proxy (with Per-User Quota) ──────────────────
@app.post("/api/ai/advise")
async def api_ai_advise(
    payload: AiAdvisePayload,
    user: sqlite3.Row = Depends(require_active_user),
):
    prompt = payload.prompt.strip()
    if not prompt or len(prompt) > 12_000:
        raise HTTPException(status_code=400, detail="AI 요청 프롬프트 길이가 올바르지 않습니다.")

    with get_db() as conn:
        api_key = get_setting(conn, "gemini_api_key", "").strip()
        if not api_key:
            raise HTTPException(status_code=503, detail="서버 공용 AI 키가 아직 설정되지 않았습니다.")
        limit = int(get_setting(conn, "daily_ai_limit", "30") or "30")
        today = today_kst_str()
        u_row = conn.execute("SELECT daily_ai_count, daily_ai_date FROM users WHERE id = ?", (user["id"],)).fetchone()
        used = int(u_row["daily_ai_count"]) if u_row and u_row["daily_ai_date"] == today else 0
        if limit <= 0 or (user["role"] != "admin" and used >= limit):
            raise HTTPException(status_code=429, detail=f"일일 AI 자문 한도({limit}회)에 도달했습니다.")
        conn.execute(
            "UPDATE users SET daily_ai_count = ?, daily_ai_date = ? WHERE id = ?",
            (used + 1, today, user["id"]),
        )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    body = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            "아래 화학공정 시뮬레이션 데이터(성분, 비점, 압력, 응축기 형태, 온도, 순도 목표 vs 계산값)를 기술적으로 분석해 작성하세요.\n"
                            "작성 규칙:\n"
                            "1. 자기소개·역할 언급·인사말('엔지니어로서', '경력의', '분석한 결과' 등)은 절대 쓰지 말고 첫 줄부터 바로 본론만 작성할 것.\n"
                            "2. 마크다운 기호(###, **, *)를 절대 쓰지 말고, 깔끔한 일반 텍스트('[근본 원인]', '[해결 방안]', '1.', '2.', '3.', '-')만 사용할 것.\n"
                            "3. 자동 최적화 실패 또는 목표 순도 미달 시: 추상적 일반론(CFD 시뮬레이션 등)을 쓰지 말고, 실제 성분·비점·임계온도(비응축 가스 여부)·전응축/부분응축·공비/핀치·압력·D/F 물질수지 한계에 근거해 [근본 원인]과 [해결 방안] 3가지를 구체적 수치·장치 변경안으로 작성할 것.\n"
                            "4. 정상 수렴 완료 시: 핵심 운전 평가 2~3줄만 간결히 작성할 것.\n\n"
                            + prompt
                        )
                    }
                ]
            }
        ],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 900, "thinkingConfig": {"thinkingBudget": 0}},
    }
    try:
        async with httpx.AsyncClient(timeout=18.0) as client:
            res = await client.post(url, json=body)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail="AI 모델 호출에 실패했습니다.")
        data = res.json()
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )
        if text:
            text = re.sub(r"(?m)^\s*#{1,6}\s*", "", text)
            text = text.replace("**", "")
            text = re.sub(r"(?m)^\s*\*\s+", "- ", text)
        return {"text": text or None, "remaining": max(0, limit - used - 1)}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="AI 서버 응답 지연으로 로컬 자문으로 전환합니다.")


# ── Admin Console Endpoints (Session OR Master Key) ─────────────────────
def _active_session_counts_by_user(conn: sqlite3.Connection) -> dict[int, dict[str, int]]:
    now_iso = iso_now()
    rows = conn.execute(
        """
        SELECT user_id,
               COALESCE(NULLIF(device_type, ''), 'desktop') AS dtype,
               COUNT(*) AS cnt
        FROM sessions
        WHERE expires_at > ?
        GROUP BY user_id, dtype
        """,
        (now_iso,),
    ).fetchall()
    counts: dict[int, dict[str, int]] = {}
    for r in rows:
        uid = int(r["user_id"])
        bucket = counts.setdefault(uid, {"desktop": 0, "mobile": 0})
        dtype = "mobile" if r["dtype"] == "mobile" else "desktop"
        bucket[dtype] = int(r["cnt"])
    return counts


@app.get("/api/admin/overview")
def api_admin_overview(_admin: Optional[sqlite3.Row] = Depends(require_admin_or_master)):
    with get_db() as conn:
        reg_mode = get_setting(conn, "registration_mode", "invite_only")
        ai_limit = int(get_setting(conn, "daily_ai_limit", "30") or "30")
        has_gemini = bool(get_setting(conn, "gemini_api_key", "").strip())
        sess_counts = _active_session_counts_by_user(conn)

        user_rows = conn.execute(
            """
            SELECT u.*,
                   COUNT(w.workspace_key) AS ws_count,
                   COALESCE(SUM(LENGTH(w.payload_json)), 0) AS ws_bytes
            FROM users u
            LEFT JOIN user_workspaces w ON w.user_id = u.id
            GROUP BY u.id
            ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.id ASC
            """
        ).fetchall()
        invite_rows = conn.execute(
            """
            SELECT i.*, u.display_name AS created_by_name
            FROM invite_codes i
            LEFT JOIN users u ON u.id = i.created_by
            ORDER BY i.created_at DESC
            """
        ).fetchall()
        return {
            "registration_mode": reg_mode,
            "daily_ai_limit": ai_limit,
            "has_gemini_key": has_gemini,
            "users": [
                {
                    **serialize_user(r),
                    "signup_source": (r["signup_source"] if "signup_source" in r.keys() else "") or "",
                    "workspace_count": r["ws_count"],
                    "workspace_bytes": r["ws_bytes"],
                    "active_desktop_sessions": sess_counts.get(int(r["id"]), {}).get("desktop", 0),
                    "active_mobile_sessions": sess_counts.get(int(r["id"]), {}).get("mobile", 0),
                }
                for r in user_rows
            ],
            "invites": [
                {
                    "code": r["code"],
                    "memo": r["memo"],
                    "max_uses": r["max_uses"],
                    "used_count": r["used_count"],
                    "expires_at": r["expires_at"],
                    "is_active": bool(r["is_active"]),
                    "created_at": r["created_at"],
                    "created_by_name": r["created_by_name"],
                }
                for r in invite_rows
            ],
        }


@app.put("/api/admin/settings")
def api_admin_settings(
    payload: AdminSettingsPayload,
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    with get_db() as conn:
        if payload.registration_mode is not None:
            set_setting(conn, "registration_mode", payload.registration_mode)
        if payload.daily_ai_limit is not None:
            set_setting(conn, "daily_ai_limit", str(max(0, min(10000, payload.daily_ai_limit))))
        if payload.gemini_api_key is not None:
            set_setting(conn, "gemini_api_key", payload.gemini_api_key.strip())
    return {"ok": True}


@app.get("/api/admin/users")
def api_admin_list_users(_admin: Optional[sqlite3.Row] = Depends(require_admin_or_master)):
    with get_db() as conn:
        sess_counts = _active_session_counts_by_user(conn)
        user_rows = conn.execute(
            """
            SELECT u.*,
                   COUNT(w.workspace_key) AS ws_count,
                   COALESCE(SUM(LENGTH(w.payload_json)), 0) AS ws_bytes
            FROM users u
            LEFT JOIN user_workspaces w ON w.user_id = u.id
            GROUP BY u.id
            ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.id ASC
            """
        ).fetchall()
        return {
            "users": [
                {
                    **serialize_user(r),
                    "workspace_count": r["ws_count"],
                    "workspace_bytes": r["ws_bytes"],
                    "active_desktop_sessions": sess_counts.get(int(r["id"]), {}).get("desktop", 0),
                    "active_mobile_sessions": sess_counts.get(int(r["id"]), {}).get("mobile", 0),
                }
                for r in user_rows
            ]
        }


@app.post("/api/admin/users")
def api_admin_create_user(
    payload: AdminCreateUserPayload,
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    uname, email_val = _normalize_username_and_email(payload.username, payload.email)
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 6자 이상이어야 합니다.")
    dname = payload.display_name.strip() or (uname.split("@")[0] if "@" in uname else uname)
    allowed_db = (
        None
        if payload.role == "admin"
        else normalize_allowed_plants_for_db(payload.allowed_plants)
    )
    with get_db() as conn:
        exists_u = conn.execute(
            "SELECT id FROM users WHERE lower(username) = lower(?)",
            (uname,),
        ).fetchone()
        if exists_u:
            raise HTTPException(status_code=409, detail="이미 존재하는 아이디입니다.")
        if email_val:
            exists_e = conn.execute(
                """
                SELECT id FROM users
                WHERE (email != '' AND lower(email) = lower(?)) OR lower(username) = lower(?)
                """,
                (email_val, email_val),
            ).fetchone()
            if exists_e:
                raise HTTPException(status_code=409, detail="이미 등록된 이메일 주소입니다.")
        cur = conn.execute(
            """
            INSERT INTO users(username, email, display_name, password_hash, role, status, allowed_plants, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
            """,
            (
                uname,
                email_val,
                dname,
                hash_password(payload.password),
                payload.role,
                allowed_db,
                iso_now(),
            ),
        )
        created = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        return {
            "ok": True,
            "user_id": cur.lastrowid,
            "user": serialize_user(created) if created else None,
        }


@app.post("/api/admin/users/{user_id}/revoke-sessions")
def api_admin_revoke_user_sessions(
    user_id: int,
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    with get_db() as conn:
        target = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
        cur = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return {"ok": True, "revoked_count": cur.rowcount}


@app.patch("/api/admin/users/{user_id}")
def api_admin_update_user(
    user_id: int,
    payload: AdminUpdateUserPayload,
    admin_row: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    fields_set = getattr(payload, "model_fields_set", set())
    with get_db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
        if admin_row and admin_row["id"] == user_id and payload.status and payload.status != "active":
            raise HTTPException(status_code=400, detail="현재 로그인한 본인의 관리자 계정은 정지할 수 없습니다.")
        if payload.status is not None:
            conn.execute("UPDATE users SET status = ? WHERE id = ?", (payload.status, user_id))
            if payload.status != "active":
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        if payload.role is not None:
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (payload.role, user_id))
        if "allowed_plants" in fields_set:
            allowed_db = normalize_allowed_plants_for_db(payload.allowed_plants)
            conn.execute("UPDATE users SET allowed_plants = ? WHERE id = ?", (allowed_db, user_id))
        if payload.new_password is not None:
            if len(payload.new_password) < 6:
                raise HTTPException(status_code=400, detail="비밀번호는 6자 이상이어야 합니다.")
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(payload.new_password), user_id),
            )
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        if payload.reset_workspace:
            conn.execute("DELETE FROM user_workspaces WHERE user_id = ?", (user_id,))
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"ok": True, "user": serialize_user(updated) if updated else None}


@app.delete("/api/admin/users/{user_id}")
def api_admin_delete_user(
    user_id: int,
    admin_row: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    if admin_row and admin_row["id"] == user_id:
        raise HTTPException(status_code=400, detail="현재 로그인한 본인 계정은 삭제할 수 없습니다.")
    with get_db() as conn:
        target = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
        if target["role"] == "admin":
            admin_cnt = conn.execute("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'").fetchone()["cnt"]
            if admin_cnt <= 1:
                raise HTTPException(status_code=400, detail="최소 1명의 관리자가 남아있어야 합니다.")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"ok": True}


@app.post("/api/admin/invites")
def api_admin_create_invite(
    payload: AdminCreateInvitePayload,
    admin_row: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    code = (payload.code or f"CHEM-{secrets.token_hex(3).upper()}").strip().upper()
    if len(code) < 4 or len(code) > 40:
        raise HTTPException(status_code=400, detail="초대코드 길이는 4~40자여야 합니다.")
    expires_at = None
    if payload.expires_days and payload.expires_days > 0:
        expires_at = (utcnow() + timedelta(days=payload.expires_days)).isoformat()
    with get_db() as conn:
        exists = conn.execute("SELECT code FROM invite_codes WHERE code = ?", (code,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="동일한 초대코드가 이미 존재합니다.")
        conn.execute(
            """
            INSERT INTO invite_codes(code, memo, max_uses, used_count, expires_at, is_active, created_by, created_at)
            VALUES (?, ?, ?, 0, ?, 1, ?, ?)
            """,
            (
                code,
                payload.memo.strip(),
                max(1, min(10000, payload.max_uses)),
                expires_at,
                admin_row["id"] if admin_row else None,
                iso_now(),
            ),
        )
    return {"code": code}


@app.patch("/api/admin/invites/{code}")
def api_admin_toggle_invite(
    code: str,
    payload: AdminToggleInvitePayload,
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    with get_db() as conn:
        conn.execute(
            "UPDATE invite_codes SET is_active = ? WHERE code = ?",
            (1 if payload.is_active else 0, code.strip().upper()),
        )
    return {"ok": True}


# ── In-App Beta Feedback & Markdown Backlog ─────────────────────────────
FEEDBACK_BACKLOG_PATH = DATA_DIR / "beta_feedback_backlog.md"


def serialize_feedback(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "username": row["username"],
        "email": row["email"] or "",
        "category": row["category"],
        "page_path": row["page_path"] or "",
        "device_type": row["device_type"] or "desktop",
        "lang": row["lang"] or "ko",
        "unit_preset": row["unit_preset"] or "METRIC_ENG",
        "message": row["message"],
        "status": row["status"],
        "admin_note": row["admin_note"] or "",
        "created_at": row["created_at"],
    }


def sync_feedback_backlog_md(conn: sqlite3.Connection) -> None:
    """Write grouped Markdown backlog to DATA_DIR / 'beta_feedback_backlog.md'."""
    rows = conn.execute(
        """
        SELECT id, user_id, username, email, category, page_path,
               device_type, lang, unit_preset, message, status, admin_note, created_at
        FROM feedback_items
        ORDER BY id DESC
        """
    ).fetchall()

    grouped: dict[str, list[sqlite3.Row]] = {"new": [], "in_progress": [], "done": []}
    for r in rows:
        st = r["status"] if r["status"] in grouped else "new"
        grouped[st].append(r)

    updated_kst = (utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M:%S KST")
    lines: list[str] = [
        "# ChemPlant Studio — Beta Feedback Backlog",
        "",
        f"- Updated: `{updated_kst}`",
        f"- Summary: Total **{len(rows)}** | New **{len(grouped['new'])}** | In Progress **{len(grouped['in_progress'])}** | Done **{len(grouped['done'])}**",
        "",
    ]

    sections = [
        ("new", "New"),
        ("in_progress", "In Progress"),
        ("done", "Done"),
    ]
    for status_key, title in sections:
        items = grouped[status_key]
        lines.append(f"## {title} ({len(items)})")
        lines.append("")
        if not items:
            lines.append("_No items._")
            lines.append("")
            continue
        for r in items:
            who = r["username"]
            email_val = (r["email"] or "").strip()
            if email_val and email_val.lower() != who.lower():
                who = f"{who} ({email_val})"
            lines.append(
                f"### #{r['id']} [{r['category']}] {who} — `{r['created_at']}`"
            )
            lines.append(
                f"- Page: `{r['page_path'] or '/'}` | Device: `{r['device_type'] or 'desktop'}` | Lang: `{r['lang'] or 'ko'}` | Units: `{r['unit_preset'] or 'METRIC_ENG'}`"
            )
            msg_lines = (r["message"] or "").splitlines() or [""]
            for ml in msg_lines:
                lines.append(f"> {ml}")
            note = (r["admin_note"] or "").strip()
            if note:
                lines.append(f"- Admin Note: {note}")
            lines.append("")

    FEEDBACK_BACKLOG_PATH.write_text("\n".join(lines), encoding="utf-8")
    try:
        os.chmod(FEEDBACK_BACKLOG_PATH, 0o600)
    except OSError:
        pass


@app.post("/api/feedback")
def api_submit_feedback(
    payload: FeedbackCreatePayload,
    request: Request,
    user: sqlite3.Row = Depends(require_active_user),
):
    msg = payload.message.strip()
    if len(msg) < 2 or len(msg) > 2000:
        raise HTTPException(
            status_code=400,
            detail="피드백 내용은 2자 이상 2000자 이하로 입력해야 합니다.",
        )
    ua_raw = request.headers.get("user-agent", "")[:240]
    device_type, _ = parse_user_agent(ua_raw)
    page_path = (payload.page_path or "").strip()[:240]
    lang = "en" if (payload.lang or "").strip().lower() == "en" else "ko"
    unit_preset = ((payload.unit_preset or "METRIC_ENG").strip()[:60]) or "METRIC_ENG"
    user_email = (user["email"] if "email" in user.keys() else "") or ""

    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO feedback_items(
                user_id, username, email, category, page_path,
                device_type, lang, unit_preset, message, status, admin_note, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?)
            """,
            (
                user["id"],
                user["username"],
                user_email,
                payload.category,
                page_path,
                device_type,
                lang,
                unit_preset,
                msg,
                iso_now(),
            ),
        )
        new_id = int(cur.lastrowid)

        attachment_saved = ""
        if payload.attachment_base64 and payload.attachment_name:
            import base64
            raw_b64 = payload.attachment_base64.strip()
            if "," in raw_b64[:64]:
                raw_b64 = raw_b64.split(",", 1)[1]
            try:
                raw_bytes = base64.b64decode(raw_b64, validate=True)
            except Exception:
                raise HTTPException(status_code=400, detail="첨부파일 인코딩이 올바르지 않습니다.")
            if len(raw_bytes) > 8 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="첨부파일은 최대 8MB까지 업로드할 수 있습니다.")
            safe_orig = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(payload.attachment_name.strip()))[:80] or "upload.bin"
            uploads_dir = DATA_DIR / "feedback_uploads"
            uploads_dir.mkdir(parents=True, exist_ok=True)
            saved_name = f"fb_{new_id}_{safe_orig}"
            dest = uploads_dir / saved_name
            dest.write_bytes(raw_bytes)
            try:
                os.chmod(dest, 0o600)
            except OSError:
                pass
            attachment_saved = saved_name
            size_kb = max(1, round(len(raw_bytes) / 1024))
            conn.execute(
                "UPDATE feedback_items SET admin_note = ? WHERE id = ?",
                (f"[첨부파일: {saved_name} ({size_kb} KB)]", new_id),
            )

        sync_feedback_backlog_md(conn)
    return {"ok": True, "id": new_id, "attachment_saved": attachment_saved}


@app.get("/api/feedback/my")
def api_my_feedback(
    user: sqlite3.Row = Depends(require_active_user),
):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, category, message, status, admin_note, created_at
            FROM feedback_items
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 30
            """,
            (int(user["id"]),),
        ).fetchall()
        return {
            "items": [
                {
                    "id": int(r["id"]),
                    "category": r["category"] or "bug",
                    "message": r["message"] or "",
                    "status": r["status"] or "open",
                    "admin_note": r["admin_note"] or "",
                    "created_at": r["created_at"] or "",
                }
                for r in rows
            ]
        }


@app.get("/api/admin/feedback")
def api_admin_list_feedback(
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, username, email, category, page_path,
                   device_type, lang, unit_preset, message, status, admin_note, created_at
            FROM feedback_items
            ORDER BY id DESC
            """
        ).fetchall()
        return {"items": [serialize_feedback(r) for r in rows]}


@app.patch("/api/admin/feedback/{item_id}")
def api_admin_update_feedback(
    item_id: int,
    payload: AdminUpdateFeedbackPayload,
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM feedback_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="피드백 항목을 찾을 수 없습니다.")
        if payload.status is not None:
            conn.execute(
                "UPDATE feedback_items SET status = ? WHERE id = ?",
                (payload.status, item_id),
            )
        if payload.admin_note is not None:
            conn.execute(
                "UPDATE feedback_items SET admin_note = ? WHERE id = ?",
                (payload.admin_note.strip()[:1000], item_id),
            )
        sync_feedback_backlog_md(conn)
        updated = conn.execute(
            "SELECT * FROM feedback_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return {"ok": True, "item": serialize_feedback(updated)}


# ── Privacy-Safe Interop & Missing-Component Gap Telemetry ──────────────
INTEROP_GAP_BACKLOG_PATH = DATA_DIR / "interop_gap_backlog.md"


def _sanitize_gap_list(items: list[str], max_items: int = 40, max_len: int = 120) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in items:
        if not isinstance(raw, str):
            continue
        val = " ".join(raw.strip().split())[:max_len]
        if not val or val in seen:
            continue
        seen.add(val)
        cleaned.append(val)
        if len(cleaned) >= max_items:
            break
    return cleaned


def _parse_json_str_list(raw: Any) -> list[str]:
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(x).strip() for x in parsed if isinstance(x, str) and x.strip()]


def _aggregate_interop_gaps(conn: sqlite3.Connection) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT source_type, unmapped_components, unsupported_blocks,
               connection_warnings, missing_searches, created_at
        FROM interop_gap_logs
        ORDER BY id DESC
        """
    ).fetchall()

    source_counts: dict[str, int] = {}
    unmapped_counts: dict[str, int] = {}
    missing_counts: dict[str, int] = {}
    block_counts: dict[str, int] = {}
    warning_counts: dict[str, int] = {}

    for r in rows:
        st = (r["source_type"] or "bkp").strip()
        source_counts[st] = source_counts.get(st, 0) + 1
        for item in _parse_json_str_list(r["unmapped_components"]):
            unmapped_counts[item] = unmapped_counts.get(item, 0) + 1
        for item in _parse_json_str_list(r["missing_searches"]):
            missing_counts[item] = missing_counts.get(item, 0) + 1
        for item in _parse_json_str_list(r["unsupported_blocks"]):
            block_counts[item] = block_counts.get(item, 0) + 1
        for item in _parse_json_str_list(r["connection_warnings"]):
            warning_counts[item] = warning_counts.get(item, 0) + 1

    def _to_sorted_list(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [
            {"item": k, "count": v}
            for k, v in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0].lower()))
        ]

    return {
        "total_logs": len(rows),
        "source_counts": source_counts,
        "unmapped_components": _to_sorted_list(unmapped_counts),
        "missing_searches": _to_sorted_list(missing_counts),
        "unsupported_blocks": _to_sorted_list(block_counts),
        "connection_warnings": _to_sorted_list(warning_counts),
    }


def sync_interop_gap_backlog_md(conn: sqlite3.Connection) -> None:
    """Aggregate anonymous engineering gap telemetry into DATA_DIR / 'interop_gap_backlog.md'."""
    agg = _aggregate_interop_gaps(conn)
    updated_kst = (utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M:%S KST")

    source_summary = ", ".join(
        f"`{k}`: **{v}**"
        for k, v in sorted(agg["source_counts"].items(), key=lambda kv: (-kv[1], kv[0]))
    ) or "_none_"

    lines: list[str] = [
        "# ChemPlant Studio — Interop & Missing-Component Gap Backlog",
        "",
        f"- Updated: `{updated_kst}`",
        f"- Total Anonymous Reports: **{agg['total_logs']}** ({source_summary})",
        "- Privacy: No user PII and no filenames are stored.",
        "",
    ]

    sections = [
        ("1. 미매핑 물질 (`.bkp` / `.inp`)", agg["unmapped_components"]),
        ("2. 검색 결과 0건 물질 (물성 DB / 성분 검색)", agg["missing_searches"]),
        ("3. 미지원 / 대체 매핑 블록 유형", agg["unsupported_blocks"]),
        ("4. 연결점 / 포트 경고", agg["connection_warnings"]),
    ]

    for title, entries in sections:
        lines.append(f"## {title} ({len(entries)})")
        lines.append("")
        if not entries:
            lines.append("_No items._")
            lines.append("")
            continue
        lines.append("| Item | Count |")
        lines.append("| --- | ---: |")
        for entry in entries:
            safe_item = str(entry["item"]).replace("|", "\\|")
            lines.append(f"| `{safe_item}` | {entry['count']} |")
        lines.append("")

    INTEROP_GAP_BACKLOG_PATH.write_text("\n".join(lines), encoding="utf-8")
    try:
        os.chmod(INTEROP_GAP_BACKLOG_PATH, 0o600)
    except OSError:
        pass


@app.post("/api/telemetry/interop-gaps")
def api_report_interop_gaps(
    payload: InteropGapPayload,
    _user: sqlite3.Row = Depends(require_active_user),
):
    unmapped = _sanitize_gap_list(payload.unmapped_components)
    unsupported = _sanitize_gap_list(payload.unsupported_blocks)
    warnings = _sanitize_gap_list(payload.connection_warnings)
    missing = _sanitize_gap_list(payload.missing_searches)

    if not (unmapped or unsupported or warnings or missing):
        return {"ok": True}

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO interop_gap_logs(
                source_type, unmapped_components, unsupported_blocks,
                connection_warnings, missing_searches, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                payload.source_type,
                json.dumps(unmapped, ensure_ascii=False),
                json.dumps(unsupported, ensure_ascii=False),
                json.dumps(warnings, ensure_ascii=False),
                json.dumps(missing, ensure_ascii=False),
                iso_now(),
            ),
        )
        sync_interop_gap_backlog_md(conn)

    return {"ok": True}


@app.get("/api/admin/interop-gaps")
def api_admin_get_interop_gaps(
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    with get_db() as conn:
        return _aggregate_interop_gaps(conn)


# ── Community Custom Component Request & Auto-Calibration ───────────────
_ATOMIC_WEIGHTS: dict[str, float] = {
    "H": 1.008,
    "He": 4.0026,
    "Li": 6.94,
    "B": 10.81,
    "C": 12.011,
    "N": 14.007,
    "O": 15.999,
    "F": 18.998,
    "Ne": 20.180,
    "Na": 22.990,
    "Mg": 24.305,
    "Al": 26.982,
    "Si": 28.085,
    "P": 30.974,
    "S": 32.06,
    "Cl": 35.45,
    "Ar": 39.948,
    "K": 39.098,
    "Ca": 40.078,
    "Ti": 47.867,
    "Cr": 51.996,
    "Mn": 54.938,
    "Fe": 55.845,
    "Co": 58.933,
    "Ni": 58.693,
    "Cu": 63.546,
    "Zn": 65.38,
    "Br": 79.904,
    "Kr": 83.798,
    "Ag": 107.868,
    "Sn": 118.710,
    "I": 126.904,
    "Xe": 131.293,
    "Ba": 137.327,
    "Pt": 195.084,
    "Au": 196.967,
    "Pb": 207.2,
}

_CAS_RN_RE = re.compile(r"\b(\d{2,7}-\d{2}-\d)\b")
_FORMULA_TOKEN_RE = re.compile(r"([A-Z][a-z]?|\(|\)|\[|\]|\d+(?:\.\d+)?)")
_REDUCED_PRESSURE_RE = re.compile(
    r"(?:\bmm\s*hg\b|\btorr\b|\bpa\b|\bmbar\b|\bhpa\b|\bat\s+\d+(?:\.\d+)?\s*(?:mm|torr|kpa|pa))",
    re.IGNORECASE,
)


def _clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


def _parse_chemical_formula(formula: str) -> tuple[dict[str, float], Optional[float]]:
    """Parse chemical formula (including parentheses & dot-hydrates) into element counts and MW."""
    raw = (formula or "").strip()
    if not raw:
        return {}, None
    # Strip trailing charge notation like +, -, 2+, 2-
    cleaned = re.sub(r"[\s]+", "", raw)
    if not cleaned:
        return {}, None

    total_counts: dict[str, float] = {}
    parts = re.split(r"[·•.]", cleaned)
    for part in parts:
        if not part:
            continue
        m_lead = re.match(r"^(\d+(?:\.\d+)?)(.+)$", part)
        part_mult = 1.0
        body = part
        if m_lead:
            part_mult = float(m_lead.group(1))
            body = m_lead.group(2)

        tokens = _FORMULA_TOKEN_RE.findall(body)
        if not tokens:
            continue

        stack: list[dict[str, float]] = [{}]
        i = 0
        valid_part = True
        while i < len(tokens):
            tok = tokens[i]
            if tok in ("(", "["):
                stack.append({})
                i += 1
            elif tok in (")", "]"):
                if len(stack) <= 1:
                    valid_part = False
                    break
                group = stack.pop()
                mult = 1.0
                if i + 1 < len(tokens) and re.match(r"^\d+(?:\.\d+)?$", tokens[i + 1]):
                    mult = float(tokens[i + 1])
                    i += 2
                else:
                    i += 1
                for el, cnt in group.items():
                    stack[-1][el] = stack[-1].get(el, 0.0) + cnt * mult
            elif tok in _ATOMIC_WEIGHTS:
                mult = 1.0
                if i + 1 < len(tokens) and re.match(r"^\d+(?:\.\d+)?$", tokens[i + 1]):
                    mult = float(tokens[i + 1])
                    i += 2
                else:
                    i += 1
                stack[-1][tok] = stack[-1].get(tok, 0.0) + mult
            else:
                # Unknown symbol or stray number
                i += 1

        if not valid_part:
            continue
        while len(stack) > 1:
            top = stack.pop()
            for el, cnt in top.items():
                stack[-1][el] = stack[-1].get(el, 0.0) + cnt
        for el, cnt in stack[0].items():
            total_counts[el] = total_counts.get(el, 0.0) + cnt * part_mult

    if not total_counts:
        return {}, None

    mw = sum(cnt * _ATOMIC_WEIGHTS[el] for el, cnt in total_counts.items() if el in _ATOMIC_WEIGHTS)
    if mw <= 0.0:
        return total_counts, None
    return total_counts, round(mw, 4)


def _extract_temp_c(text: str) -> Optional[float]:
    """Extract a temperature in °C from a PubChem property string (°C, K, or °F)."""
    if not text:
        return None
    # Prefer °C
    m_c = re.search(r"(-?\d+(?:\.\d+)?)\s*(?:°\s*C|℃|deg\s*C|\bC\b)", text)
    if m_c:
        val = float(m_c.group(1))
        if -270.0 <= val <= 1200.0:
            return val
    # Try Kelvin
    m_k = re.search(r"(\d+(?:\.\d+)?)\s*K\b", text)
    if m_k:
        val = float(m_k.group(1)) - 273.15
        if -270.0 <= val <= 1200.0:
            return val
    # Try °F
    m_f = re.search(r"(-?\d+(?:\.\d+)?)\s*(?:°\s*F|℉|deg\s*F|\bF\b)", text)
    if m_f:
        val = (float(m_f.group(1)) - 32.0) * 5.0 / 9.0
        if -270.0 <= val <= 1200.0:
            return val
    return None


def _extract_density_kg_m3(text: str) -> Optional[float]:
    """Extract liquid density in kg/m³ from a PubChem property string."""
    if not text:
        return None
    m_gcm3 = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:g\s*/\s*(?:cm3|cm³|cu\s*cm|mL|ml|cc)|g·cm-3)",
        text,
        re.IGNORECASE,
    )
    if m_gcm3:
        val = float(m_gcm3.group(1))
        if 0.25 <= val <= 5.0:
            return val * 1000.0
    m_kgm3 = re.search(r"(\d+(?:\.\d+)?)\s*kg\s*/\s*(?:m3|m³)", text, re.IGNORECASE)
    if m_kgm3:
        val = float(m_kgm3.group(1))
        if 250.0 <= val <= 5000.0:
            return val
    # Bare decimal density like "0.789 at 20 °C"
    m_bare = re.match(r"^\s*(\d+\.\d+)\b", text)
    if m_bare:
        val = float(m_bare.group(1))
        if 0.35 <= val <= 3.5:
            return val * 1000.0
    return None


def _collect_pug_view_experimental(record_json: dict[str, Any]) -> dict[str, Any]:
    """Parse PubChem PUG-View Experimental Properties JSON for Tb, Tm, density, and CAS RN."""
    tb_atm: list[float] = []
    tb_any: list[float] = []
    tm_vals: list[float] = []
    rho_vals: list[float] = []
    cas_found: Optional[str] = None

    def _extract_info_strings(info_obj: dict[str, Any]) -> list[str]:
        out: list[str] = []
        val = info_obj.get("Value")
        if not isinstance(val, dict):
            return out
        for swm in val.get("StringWithMarkup") or []:
            if isinstance(swm, dict) and isinstance(swm.get("String"), str):
                out.append(swm["String"])
        nums = val.get("Number")
        unit = val.get("Unit") or ""
        if isinstance(nums, list) and nums:
            for n in nums:
                if isinstance(n, (int, float)):
                    out.append(f"{n} {unit}".strip())
        return out

    def _walk(sections: list[Any], heading_path: str = "") -> None:
        nonlocal cas_found
        for sec in sections:
            if not isinstance(sec, dict):
                continue
            toc = str(sec.get("TOCHeading") or "").strip()
            path = f"{heading_path}/{toc}".lower()
            for info in sec.get("Information") or []:
                if not isinstance(info, dict):
                    continue
                for s in _extract_info_strings(info):
                    if not cas_found:
                        m_cas = _CAS_RN_RE.search(s)
                        if m_cas:
                            cas_found = m_cas.group(1)
                    if "boiling point" in path:
                        t_c = _extract_temp_c(s)
                        if t_c is not None:
                            if not _REDUCED_PRESSURE_RE.search(s) or "760" in s or "1 atm" in s.lower():
                                tb_atm.append(t_c)
                            else:
                                tb_any.append(t_c)
                    elif "melting point" in path:
                        t_c = _extract_temp_c(s)
                        if t_c is not None:
                            tm_vals.append(t_c)
                    elif "density" in path:
                        rho = _extract_density_kg_m3(s)
                        if rho is not None:
                            rho_vals.append(rho)
            sub = sec.get("Section")
            if isinstance(sub, list):
                _walk(sub, path)

    rec = record_json.get("Record") if isinstance(record_json, dict) else None
    if isinstance(rec, dict) and isinstance(rec.get("Section"), list):
        _walk(rec["Section"])

    return {
        "tb_c": tb_atm[0] if tb_atm else (tb_any[0] if tb_any else None),
        "tm_c": tm_vals[0] if tm_vals else None,
        "rho_l_25": rho_vals[0] if rho_vals else None,
        "cas_no": cas_found,
    }


def calibrate_antoine_bar_c(
    tb_c: float, tc_c: float, pc_bar: float
) -> tuple[float, float, float, float, float]:
    """Fit exact 2-point Antoine parameters log10(P_bar) = A - B / (T_C + C)
    anchored at (Tb_C, 1.01325 barA) and (Tc_C, Pc_bar).
    Returns (A, B, C, P_calc_at_Tb_bar, rel_err_pct).
    """
    tb_k = tb_c + 273.15
    tc_c_eff = max(tc_c, tb_c + 40.0)
    pc_bar_eff = max(pc_bar, 2.0)

    c_val = _clamp(273.15 - 0.19 * tb_k, 150.0, 265.0)
    if tb_c + c_val <= 5.0:
        c_val = 5.0 - tb_c

    y1 = math.log10(1.01325)
    y2 = math.log10(pc_bar_eff)
    inv1 = 1.0 / (tb_c + c_val)
    inv2 = 1.0 / (tc_c_eff + c_val)
    b_val = (y2 - y1) / (inv1 - inv2)
    a_val = y1 + b_val * inv1

    p_calc_tb = 10.0 ** (a_val - b_val / (tb_c + c_val))
    rel_err_pct = abs(p_calc_tb - 1.01325) / 1.01325 * 100.0
    return (
        round(a_val, 6),
        round(b_val, 4),
        round(c_val, 4),
        p_calc_tb,
        rel_err_pct,
    )


async def lookup_and_calibrate_component(
    query: str,
    name_ko: Optional[str] = None,
    formula: Optional[str] = None,
    cas_no: Optional[str] = None,
    user_tb_c: Optional[float] = None,
    user_rho_25: Optional[float] = None,
) -> dict[str, Any]:
    """Query PubChem (with graceful offline fallback) and calibrate engineering properties."""
    clean_query = (query or "").strip()
    clean_name_ko = (name_ko or "").strip()
    clean_formula = (formula or "").strip()
    clean_cas = (cas_no or "").strip()

    pubchem_cid: Optional[int] = None
    pubchem_formula = ""
    pubchem_mw: Optional[float] = None
    pubchem_smiles = ""
    pubchem_iupac = ""
    pubchem_exp: dict[str, Any] = {}
    sources: list[str] = []

    search_candidates: list[str] = []
    for cand in (clean_cas, clean_query, clean_formula):
        if cand and cand not in search_candidates:
            search_candidates.append(cand)

    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            for cand in search_candidates:
                url = (
                    f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/"
                    f"{quote(cand, safe='')}/property/"
                    f"MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON"
                )
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        data = resp.json()
                        props_list = (data.get("PropertyTable") or {}).get("Properties") or []
                        if props_list:
                            p0 = props_list[0]
                            pubchem_cid = int(p0["CID"]) if p0.get("CID") is not None else None
                            pubchem_formula = str(p0.get("MolecularFormula") or "").strip()
                            if p0.get("MolecularWeight") is not None:
                                try:
                                    pubchem_mw = float(p0["MolecularWeight"])
                                except (TypeError, ValueError):
                                    pubchem_mw = None
                            pubchem_smiles = str(
                                p0.get("CanonicalSMILES")
                                or p0.get("ConnectivitySMILES")
                                or p0.get("SMILES")
                                or ""
                            ).strip()
                            pubchem_iupac = str(p0.get("IUPACName") or "").strip()
                            sources.append(f"PubChem CID {pubchem_cid}" if pubchem_cid else "PubChem PUG")
                            break
                except Exception:
                    continue

            if pubchem_cid is not None:
                exp_url = (
                    f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/"
                    f"{pubchem_cid}/JSON?heading=Experimental+Properties"
                )
                try:
                    exp_resp = await client.get(exp_url, timeout=6.0)
                    if exp_resp.status_code == 200:
                        pubchem_exp = _collect_pug_view_experimental(exp_resp.json())
                        if any(pubchem_exp.get(k) is not None for k in ("tb_c", "tm_c", "rho_l_25")):
                            sources.append("PubChem Experimental")
                except Exception:
                    pass
    except Exception:
        pass

    final_formula = pubchem_formula or clean_formula or clean_query
    el_counts, parsed_mw = _parse_chemical_formula(final_formula)
    if not el_counts and clean_formula and clean_formula != final_formula:
        el_counts, parsed_mw = _parse_chemical_formula(clean_formula)

    # 1. Molecular Weight
    if pubchem_mw is not None and pubchem_mw > 0:
        mw = round(pubchem_mw, 4)
    elif parsed_mw is not None and parsed_mw > 0:
        mw = round(parsed_mw, 4)
        sources.append("Formula MW")
    else:
        mw = 100.0
        sources.append("Default MW(100)")
    mw = max(2.0, mw)

    # 2. Normal Boiling Point (Tb)
    tb_source = "MW correlation"
    if user_tb_c is not None:
        tb_c = float(user_tb_c)
        tb_source = "User Tb"
    elif pubchem_exp.get("tb_c") is not None:
        tb_c = float(pubchem_exp["tb_c"])
        tb_source = "PubChem Tb"
    else:
        tb_k_est = 198.0 + 18.5 * (mw ** 0.52)
        tb_c = _clamp(tb_k_est - 273.15, -160.0, 480.0)
        tb_source = "MW correlation"
    tb_c = round(_clamp(tb_c, -250.0, 900.0), 2)
    tb_k = tb_c + 273.15

    # 3. Melting Point (Tm)
    if pubchem_exp.get("tm_c") is not None:
        tm_c = round(float(pubchem_exp["tm_c"]), 2)
    else:
        tm_c = round(tb_c - 95.0, 2)

    # 4. Polarity & Family classification
    n_o = el_counts.get("O", 0.0)
    n_n = el_counts.get("N", 0.0)
    n_f = el_counts.get("F", 0.0)
    n_cl = el_counts.get("Cl", 0.0)
    n_hal = n_f + n_cl + el_counts.get("Br", 0.0) + el_counts.get("I", 0.0)
    is_polar = (n_o + n_n + n_f) > 0.0
    is_gas_std = 1 if tb_c < 20.0 else 0

    if is_gas_std:
        family = "light_gas"
    elif el_counts and set(el_counts.keys()).issubset({"C", "H"}) and el_counts.get("C", 0.0) > 0:
        family = "hydrocarbon"
    elif n_hal > 0:
        family = "halogenated"
    else:
        family = "polar_solvent"

    # 5. Critical Temperature (Tc) via Guldberg/polarity ratio
    trb = 0.655 if is_polar else 0.675
    tc_k = max(tb_k / trb, tb_k + 40.0)
    tc_c = round(tc_k - 273.15, 2)
    trb_eff = _clamp(tb_k / tc_k, 0.35, 0.90)

    # 6. Critical Pressure (Pc) via Lydersen/MW correlation
    pc_bar = round(_clamp(12.0 + 3800.0 / (mw + 45.0), 15.0, 95.0), 2)

    # 7. Acentric factor (omega) via Edmister approximation
    omega_raw = (3.0 / 7.0) * (trb_eff / (1.0 - trb_eff)) * math.log10(pc_bar / 1.01325) - 1.0
    omega = round(_clamp(omega_raw, 0.01, 0.95), 4)

    # 8. Heat of vaporization at Tb via Riedel equation
    dhv_mol = (
        1.093
        * 8.31446e-3
        * tc_k
        * (math.log(pc_bar / 1.01325) - 1.013)
        / max(0.08, 0.930 - trb_eff)
    )
    hvap_tb_kj_kg = round(_clamp(dhv_mol * 1000.0 / mw, 80.0, 2600.0), 2)

    # 9. Liquid density at 25 °C
    rho_source = "Rackett-like est."
    if user_rho_25 is not None and user_rho_25 > 0:
        rho_l_25 = round(float(user_rho_25), 2)
        rho_source = "User rho25"
    elif pubchem_exp.get("rho_l_25") is not None:
        rho_l_25 = round(float(pubchem_exp["rho_l_25"]), 2)
        rho_source = "PubChem rho"
    else:
        total_heavy = sum(v for k, v in el_counts.items() if k != "H")
        polar_hal = n_o + n_n + n_f + n_cl
        polar_ratio = (polar_hal / total_heavy) if total_heavy > 0 else 0.0
        rho_l_25 = round(_clamp(650.0 + 220.0 * polar_ratio + 1.1 * mw, 520.0, 2200.0), 2)

    # 10. Liquid & Gas heat capacities (kJ/kg·K)
    cp_liq_kj_kgk = round(_clamp(2.35 - 0.0035 * mw + (0.25 if is_polar else 0.0), 1.4, 2.6), 3)
    cp_gas_kj_kgk = round(_clamp(cp_liq_kj_kgk * 0.68, 0.9, 1.8), 3)

    # 11. Exact 2-point Antoine Calibration (barA / °C)
    ant_a, ant_b, ant_c, p_calc_tb, err_pct = calibrate_antoine_bar_c(tb_c, tc_c, pc_bar)

    final_cas = clean_cas or str(pubchem_exp.get("cas_no") or "")
    final_name_en = clean_query if re.search(r"[A-Za-z]", clean_query) else (pubchem_iupac or final_formula or clean_query)
    if pubchem_iupac and not re.search(r"[A-Za-z]", clean_query):
        final_name_en = pubchem_iupac
    final_name_ko = clean_name_ko or clean_query

    if not sources:
        sources.append("Offline Engineering Estimation")
    source_summary = f"{', '.join(sources)} | Tb: {tb_source}, rho25: {rho_source}"
    calibration_note = (
        f"Antoine(barA,°C) 2-pt fit [(Tb={tb_c:.2f}°C, 1.01325 barA), (Tc={tc_c:.2f}°C, {pc_bar:.2f} barA)] "
        f"-> P_calc(Tb)={p_calc_tb:.5f} barA (err={err_pct:.4f}%)"
    )

    return {
        "name_ko": final_name_ko,
        "name_en": final_name_en,
        "formula": final_formula or clean_query,
        "cas_no": final_cas,
        "smiles": pubchem_smiles,
        "mw": mw,
        "tb_c": tb_c,
        "tm_c": tm_c,
        "tc_c": tc_c,
        "pc_bar": pc_bar,
        "omega": omega,
        "rho_l_25": rho_l_25,
        "cp_liq_kj_kgk": cp_liq_kj_kgk,
        "cp_gas_kj_kgk": cp_gas_kj_kgk,
        "hvap_tb_kj_kg": hvap_tb_kj_kg,
        "antoine_a": ant_a,
        "antoine_b": ant_b,
        "antoine_c": ant_c,
        "family": family,
        "is_gas_std": is_gas_std,
        "source_summary": source_summary,
        "calibration_note": calibration_note,
    }


def _generate_unique_comp_key(conn: sqlite3.Connection, query: str, formula: str) -> str:
    raw_slug = re.sub(r"[^A-Za-z0-9]+", "", (query or "").upper())
    if not raw_slug:
        raw_slug = re.sub(r"[^A-Za-z0-9]+", "", (formula or "").upper())
    if not raw_slug:
        raw_slug = secrets.token_hex(4).upper()
    base_slug = raw_slug[:16]
    candidate = f"CUS_{base_slug}"[:20]

    existing = {
        r["comp_key"]
        for r in conn.execute("SELECT comp_key FROM custom_components").fetchall()
    }
    if candidate not in existing:
        return candidate

    idx = 2
    while True:
        suffix = f"_{idx}"
        trimmed = base_slug[: max(1, 20 - 4 - len(suffix))]
        cand = f"CUS_{trimmed}{suffix}"
        if cand not in existing:
            return cand
        idx += 1


def serialize_custom_component(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "comp_key": row["comp_key"],
        "name_ko": row["name_ko"],
        "name_en": row["name_en"],
        "formula": row["formula"],
        "cas_no": row["cas_no"] or "",
        "smiles": row["smiles"] or "",
        "mw": row["mw"],
        "tb_c": row["tb_c"],
        "tm_c": row["tm_c"],
        "tc_c": row["tc_c"],
        "pc_bar": row["pc_bar"],
        "omega": row["omega"],
        "rho_l_25": row["rho_l_25"],
        "cp_liq_kj_kgk": row["cp_liq_kj_kgk"],
        "cp_gas_kj_kgk": row["cp_gas_kj_kgk"],
        "hvap_tb_kj_kg": row["hvap_tb_kj_kg"],
        "antoine_a": row["antoine_a"],
        "antoine_b": row["antoine_b"],
        "antoine_c": row["antoine_c"],
        "family": row["family"] or "polar_solvent",
        "is_gas_std": bool(row["is_gas_std"]),
        "source_summary": row["source_summary"] or "",
        "calibration_note": row["calibration_note"] or "",
        "status": row["status"],
        "requested_by_user_id": row["requested_by_user_id"],
        "requested_by_username": row["requested_by_username"] or "",
        "admin_note": row["admin_note"] or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ComponentRequestPayload(BaseModel):
    query: str = Field(min_length=1, max_length=120)
    name_ko: Optional[str] = Field(default=None, max_length=120)
    formula: Optional[str] = Field(default=None, max_length=80)
    cas_no: Optional[str] = Field(default=None, max_length=40)
    user_tb_c: Optional[float] = None
    user_rho_25: Optional[float] = None
    note: Optional[str] = Field(default=None, max_length=500)
    auto_approve: bool = False


class ComponentReviewPayload(BaseModel):
    status: Literal["approved", "rejected", "pending"]
    admin_note: Optional[str] = Field(default=None, max_length=500)
    tb_c: Optional[float] = None
    tc_c: Optional[float] = None
    pc_bar: Optional[float] = None
    omega: Optional[float] = None
    rho_l_25: Optional[float] = None


@app.get("/api/components/custom")
def api_list_custom_components(
    request: Request,
    x_admin_master_key: Optional[str] = Header(default=None, alias="X-Admin-Master-Key"),
):
    is_master = bool(
        x_admin_master_key and hmac.compare_digest(x_admin_master_key.strip(), ADMIN_MASTER_KEY)
    )
    with get_db() as conn:
        user = resolve_session_user(request, conn)
        if is_master or (user and user["role"] == "admin"):
            rows = conn.execute(
                """
                SELECT * FROM custom_components
                WHERE status IN ('approved', 'pending')
                ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
                """
            ).fetchall()
        elif user:
            rows = conn.execute(
                """
                SELECT * FROM custom_components
                WHERE status = 'approved'
                   OR (status = 'pending' AND requested_by_user_id = ?)
                ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
                """,
                (user["id"],),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM custom_components
                WHERE status = 'approved'
                ORDER BY created_at DESC
                """
            ).fetchall()

    return {
        "components": [serialize_custom_component(r) for r in rows],
        "count": len(rows),
    }


@app.post("/api/components/request")
async def api_request_custom_component(
    payload: ComponentRequestPayload,
    user: sqlite3.Row = Depends(require_active_user),
):
    calibrated = await lookup_and_calibrate_component(
        query=payload.query,
        name_ko=payload.name_ko,
        formula=payload.formula,
        cas_no=payload.cas_no,
        user_tb_c=payload.user_tb_c,
        user_rho_25=payload.user_rho_25,
    )

    user_note = (payload.note or "").strip()
    source_summary = calibrated["source_summary"]
    if user_note:
        source_summary = f"{source_summary} | Note: {user_note}"

    status = "approved" if (payload.auto_approve and user["role"] == "admin") else "pending"
    now_iso = iso_now()

    with get_db() as conn:
        comp_key = _generate_unique_comp_key(conn, payload.query, calibrated["formula"])
        cur = conn.execute(
            """
            INSERT INTO custom_components(
                comp_key, name_ko, name_en, formula, cas_no, smiles,
                mw, tb_c, tm_c, tc_c, pc_bar, omega, rho_l_25,
                cp_liq_kj_kgk, cp_gas_kj_kgk, hvap_tb_kj_kg,
                antoine_a, antoine_b, antoine_c,
                family, is_gas_std, source_summary, calibration_note,
                status, requested_by_user_id, requested_by_username,
                admin_note, created_at, updated_at
            )
            VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                '', ?, ?
            )
            """,
            (
                comp_key,
                calibrated["name_ko"],
                calibrated["name_en"],
                calibrated["formula"],
                calibrated["cas_no"],
                calibrated["smiles"],
                calibrated["mw"],
                calibrated["tb_c"],
                calibrated["tm_c"],
                calibrated["tc_c"],
                calibrated["pc_bar"],
                calibrated["omega"],
                calibrated["rho_l_25"],
                calibrated["cp_liq_kj_kgk"],
                calibrated["cp_gas_kj_kgk"],
                calibrated["hvap_tb_kj_kg"],
                calibrated["antoine_a"],
                calibrated["antoine_b"],
                calibrated["antoine_c"],
                calibrated["family"],
                calibrated["is_gas_std"],
                source_summary,
                calibrated["calibration_note"],
                status,
                user["id"],
                user["username"],
                now_iso,
                now_iso,
            ),
        )
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM custom_components WHERE id = ?", (new_id,)).fetchone()

    return {"ok": True, "component": serialize_custom_component(row)}


@app.post("/api/components/{comp_id}/review")
def api_review_custom_component(
    comp_id: int,
    payload: ComponentReviewPayload,
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM custom_components WHERE id = ?", (comp_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="해당 커스텀 성분을 찾을 수 없습니다.")

        tb_c = float(payload.tb_c) if payload.tb_c is not None else float(row["tb_c"])
        tc_c = float(payload.tc_c) if payload.tc_c is not None else float(row["tc_c"])
        pc_bar = float(payload.pc_bar) if payload.pc_bar is not None else float(row["pc_bar"])
        omega = float(payload.omega) if payload.omega is not None else float(row["omega"])
        rho_l_25 = float(payload.rho_l_25) if payload.rho_l_25 is not None else float(row["rho_l_25"])
        admin_note = (
            payload.admin_note.strip()
            if payload.admin_note is not None
            else (row["admin_note"] or "")
        )

        ant_a = float(row["antoine_a"])
        ant_b = float(row["antoine_b"])
        ant_c = float(row["antoine_c"])
        cal_note = row["calibration_note"] or ""
        is_gas_std = int(row["is_gas_std"] or 0)

        recalibrated = any(v is not None for v in (payload.tb_c, payload.tc_c, payload.pc_bar))
        if recalibrated:
            tc_c = round(max(tc_c, tb_c + 40.0), 2)
            pc_bar = round(max(pc_bar, 2.0), 2)
            ant_a, ant_b, ant_c, p_calc_tb, err_pct = calibrate_antoine_bar_c(tb_c, tc_c, pc_bar)
            is_gas_std = 1 if tb_c < 20.0 else 0
            cal_note = (
                f"Admin re-calibrated Antoine(barA,°C) [(Tb={tb_c:.2f}°C, 1.01325 barA), "
                f"(Tc={tc_c:.2f}°C, {pc_bar:.2f} barA)] -> P_calc(Tb)={p_calc_tb:.5f} barA (err={err_pct:.4f}%)"
            )

        conn.execute(
            """
            UPDATE custom_components
            SET status = ?,
                admin_note = ?,
                tb_c = ?,
                tc_c = ?,
                pc_bar = ?,
                omega = ?,
                rho_l_25 = ?,
                antoine_a = ?,
                antoine_b = ?,
                antoine_c = ?,
                is_gas_std = ?,
                calibration_note = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                payload.status,
                admin_note,
                tb_c,
                tc_c,
                pc_bar,
                omega,
                rho_l_25,
                ant_a,
                ant_b,
                ant_c,
                is_gas_std,
                cal_note,
                iso_now(),
                comp_id,
            ),
        )
        updated = conn.execute("SELECT * FROM custom_components WHERE id = ?", (comp_id,)).fetchone()

    return {"ok": True, "component": serialize_custom_component(updated)}


@app.delete("/api/components/{comp_id}")
def api_delete_custom_component(
    comp_id: int,
    user: sqlite3.Row = Depends(require_active_user),
):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM custom_components WHERE id = ?", (comp_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="해당 커스텀 성분을 찾을 수 없습니다.")

        is_admin = user["role"] == "admin"
        is_owner_pending = (
            row["requested_by_user_id"] == user["id"] and row["status"] == "pending"
        )
        if not (is_admin or is_owner_pending):
            raise HTTPException(
                status_code=403,
                detail="삭제 권한이 없습니다. (관리자 또는 본인 대기중 요청만 삭제 가능)",
            )

        conn.execute("DELETE FROM custom_components WHERE id = ?", (comp_id,))

    return {"ok": True, "deleted_id": comp_id}


# ── Protected Proprietary Data + Next.js Static Export Hosting ──────────
def _safe_out_path(rel_path: str) -> Optional[Path]:
    clean = rel_path.lstrip("/")
    candidate = (OUT_DIR / clean).resolve()
    try:
        candidate.relative_to(OUT_DIR)
    except ValueError:
        return None
    return candidate


@app.get("/data/{subpath:path}")
def serve_protected_data(subpath: str, request: Request):
    # Gate converged baselines and proprietary engineering datasets behind active session
    with get_db() as conn:
        user = resolve_session_user(request, conn)
        if not user:
            return JSONResponse({"detail": "인증된 사용자만 공정 데이터에 접근할 수 있습니다."}, status_code=401)
    safe = _safe_out_path(f"data/{subpath}")
    if not safe or not safe.is_file():
        raise HTTPException(status_code=404, detail="Data file not found")
    return FileResponse(str(safe), headers={"Cache-Control": "no-store"})



# ============================================================================
# ISOLATED HEADLESS EVALUATION API (Aspen Cross-Validation Only)
# SECURITY: Strictly token-gated (X-Eval-Token). Executes ONLY pure physics
# kernel (eval_kernel.cjs) with ZERO access to commercial plants (PLANT 01-06),
# user accounts, or saved workspaces.
# ============================================================================
import subprocess as _eval_subprocess
import secrets as _eval_secrets

_EVAL_NODE_BIN = "/usr/local/bin/node"
_EVAL_KERNEL_JS = str(Path(__file__).resolve().parent / "eval_kernel.cjs")
_EVAL_REPORTS_DIR = Path(__file__).resolve().parent / "data" / "aspen_eval_reports"

def _verify_eval_token(request: Request) -> None:
    provided = (request.headers.get("x-eval-token") or "").strip()
    if not provided:
        raise HTTPException(status_code=401, detail="Missing X-Eval-Token header.")
    with get_db() as conn:
        expected = get_setting(conn, "eval_api_token", "")
    if not expected or not _eval_secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Invalid X-Eval-Token.")

@app.post("/api/eval/run")
async def api_eval_run(request: Request):
    _verify_eval_token(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")
    action = str((body or {}).get("action") or "").strip()
    payload = (body or {}).get("payload") or {}
    allowed = {"list_components", "vle", "distillation", "flowsheet", "hex", "column_internals"}
    if action not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported action. Allowed: {sorted(allowed)}")
    if not Path(_EVAL_KERNEL_JS).exists():
        raise HTTPException(status_code=503, detail="Eval kernel bundle not deployed.")
    req_json = json.dumps({"action": action, "payload": payload}, ensure_ascii=False)
    if len(req_json) > 250000:
        raise HTTPException(status_code=413, detail="Payload too large.")
    try:
        proc = _eval_subprocess.run(
            [_EVAL_NODE_BIN, _EVAL_KERNEL_JS],
            input=req_json,
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
    except _eval_subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Simulation timed out (15s limit).")
    out_txt = (proc.stdout or "").strip()
    if not out_txt:
        raise HTTPException(status_code=500, detail=(proc.stderr or "Empty kernel output")[:300])
    try:
        parsed = json.loads(out_txt)
    except Exception:
        raise HTTPException(status_code=500, detail=f"Malformed kernel JSON: {out_txt[:200]}")
    if not parsed.get("ok"):
        raise HTTPException(status_code=400, detail=parsed.get("error", "Solver error"))
    return {"ok": True, "action": action, "data": parsed.get("data")}

@app.post("/api/eval/report")
async def api_eval_report(request: Request):
    _verify_eval_token(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")
    _EVAL_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    rid = f"eval_{ts}_{_eval_secrets.token_hex(3)}"
    record = {
        "report_id": rid,
        "received_at_utc": iso_now(),
        "evaluator": str((body or {}).get("evaluator") or "Aspen-AI")[:120],
        "title": str((body or {}).get("title") or "Aspen vs ChemPlant Studio Benchmark Report")[:200],
        "markdown_report": str((body or {}).get("markdown_report") or "")[:200000],
        "json_summary": (body or {}).get("json_summary"),
    }
    out_file = _EVAL_REPORTS_DIR / f"{rid}.json"
    out_file.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report_id": rid, "saved": True}


# ---------------------------------------------------------------------------
# Process Hub (Community Flowsheet Sharing) — Private Admin Preview by default
# ---------------------------------------------------------------------------
MAX_HUB_JSON_BYTES = 200_000
MAX_HUB_DAILY_PUBLISH = 10
HUB_CATEGORIES = {"energy", "separation", "reaction", "petrochemical", "gas", "electrochem", "general"}


def _is_hub_public(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT value FROM system_settings WHERE key = 'hub_public_enabled'").fetchone()
    return bool(row and str(row["value"]).strip() == "1")


def _require_hub_access(
    request: Request,
    conn: sqlite3.Connection,
    require_auth: bool = False,
) -> Optional[sqlite3.Row]:
    user = resolve_session_user(request, conn)
    is_public = _is_hub_public(conn)
    if not is_public:
        if not user or user["role"] != "admin":
            raise HTTPException(
                status_code=403,
                detail="Process Hub is currently in private preview (Admin only).",
            )
        return user
    # Members-only beta: all Process Hub reads and writes require a logged-in account
    if not user:
        raise HTTPException(status_code=401, detail="Members only — please sign in to access Process Hub.")
    return user


def _extract_hub_preview_graph(raw_json: str) -> Optional[dict[str, Any]]:
    if not raw_json:
        return None
    try:
        parsed = json.loads(raw_json)
        if not isinstance(parsed, dict):
            return None
        sim_defs = parsed.get("simDefs")
        flow_edges = parsed.get("flowEdges")
        rf_nodes = parsed.get("rfNodes")
        if not isinstance(sim_defs, list) or len(sim_defs) == 0:
            return None
        pos_map: dict[str, tuple[float, float]] = {}
        if isinstance(rf_nodes, list):
            for rn in rf_nodes[:40]:
                if isinstance(rn, dict) and rn.get("id") and isinstance(rn.get("position"), dict):
                    try:
                        pos_map[str(rn["id"])] = (
                            float(rn["position"].get("x", 0)),
                            float(rn["position"].get("y", 0)),
                        )
                    except Exception:
                        pass
        nodes: list[dict[str, Any]] = []
        for idx, d in enumerate(sim_defs[:32]):
            if not isinstance(d, dict) or not d.get("id"):
                continue
            nid = str(d["id"])
            x, y = pos_map.get(nid, (idx * 160.0, 0.0))
            nodes.append({
                "id": nid,
                "x": round(x, 1),
                "y": round(y, 1),
                "type": str(d.get("unitType") or "unit")[:24],
                "tag": str(d.get("tag") or "")[:14],
            })
        edges: list[dict[str, str]] = []
        if isinstance(flow_edges, list):
            for e in flow_edges[:48]:
                if isinstance(e, dict) and e.get("source") and e.get("target"):
                    edges.append({"s": str(e["source"]), "t": str(e["target"])})
        return {"nodes": nodes, "edges": edges} if nodes else None
    except Exception:
        return None


def _serialize_hub_row(
    row: sqlite3.Row,
    include_json: bool = False,
    reply_count: int = 0,
) -> dict[str, Any]:
    try:
        tags = json.loads(row["tags_json"] or "[]")
        if not isinstance(tags, list):
            tags = []
    except Exception:
        tags = []
    raw_fs = row["flowsheet_json"] or ""
    keys = row.keys()
    post_type = str(row["post_type"] if "post_type" in keys and row["post_type"] else "showcase")
    is_solved = bool(row["is_solved"]) if "is_solved" in keys else False
    item: dict[str, Any] = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "category": row["category"],
        "postType": post_type,
        "isSolved": is_solved,
        "replyCount": reply_count,
        "tags": [str(t) for t in tags[:8]],
        "thermoMethod": row["thermo_method"],
        "unitCount": row["unit_count"],
        "streamCount": row["stream_count"],
        "massErrorPct": row["mass_error_pct"],
        "converged": bool(row["converged"]),
        "isOfficial": bool(row["is_official"]),
        "presetId": row["preset_id"],
        "authorId": row["author_id"],
        "authorName": row["author_name"],
        "views": row["views"],
        "forks": row["forks"],
        "likes": row["likes"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "previewGraph": _extract_hub_preview_graph(raw_fs) if raw_fs else None,
    }
    if include_json:
        item["flowsheetJson"] = raw_fs
    return item


@app.get("/api/hub/list")
def api_hub_list(
    request: Request,
    q: str = "",
    category: str = "all",
    post_type: str = "all",
    sort: str = "latest",
):
    with get_db() as conn:
        _require_hub_access(request, conn, require_auth=False)
        is_pub = _is_hub_public(conn)
        clauses = ["status = 'published'"]
        params: list[Any] = []
        cat_clean = category.strip().lower()
        if cat_clean and cat_clean != "all":
            clauses.append("category = ?")
            params.append(cat_clean)
        pt_clean = post_type.strip().lower()
        if pt_clean in ("showcase", "help"):
            clauses.append("post_type = ?")
            params.append(pt_clean)
        q_clean = q.strip()
        if q_clean:
            like_q = f"%{q_clean}%"
            clauses.append("(title LIKE ? OR description LIKE ? OR tags_json LIKE ? OR author_name LIKE ?)")
            params.extend([like_q, like_q, like_q, like_q])
        order_sql = "is_official DESC, id DESC"
        if sort == "popular":
            order_sql = "(views + forks * 3 + likes * 2) DESC, id DESC"
        elif sort == "liked":
            order_sql = "likes DESC, id DESC"
        sql = f"SELECT * FROM hub_flowsheets WHERE {' AND '.join(clauses)} ORDER BY {order_sql} LIMIT 100"
        rows = conn.execute(sql, params).fetchall()
        rc_rows = conn.execute("SELECT hub_id, COUNT(*) AS cnt FROM hub_replies GROUP BY hub_id").fetchall()
        rc_map = {int(r["hub_id"]): int(r["cnt"]) for r in rc_rows}
        return {
            "ok": True,
            "isPublic": is_pub,
            "total": len(rows),
            "items": [_serialize_hub_row(r, include_json=False, reply_count=rc_map.get(int(r["id"]), 0)) for r in rows],
        }


@app.get("/api/hub/item/{item_id}")
def api_hub_get_item(item_id: int, request: Request):
    with get_db() as conn:
        _require_hub_access(request, conn, require_auth=False)
        row = conn.execute(
            "SELECT * FROM hub_flowsheets WHERE id = ? AND status = 'published'",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Shared flowsheet not found.")
        conn.execute("UPDATE hub_flowsheets SET views = views + 1 WHERE id = ?", (item_id,))
        row = conn.execute("SELECT * FROM hub_flowsheets WHERE id = ?", (item_id,)).fetchone()
        return {"ok": True, "item": _serialize_hub_row(row, include_json=True)}


@app.post("/api/hub/publish")
async def api_hub_publish(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")
    with get_db() as conn:
        user = _require_hub_access(request, conn, require_auth=True)
        assert user is not None
        title = str((body or {}).get("title") or "").strip()[:120]
        if len(title) < 3:
            raise HTTPException(status_code=400, detail="Title must be at least 3 characters.")
        description = str((body or {}).get("description") or "").strip()[:800]
        category = str((body or {}).get("category") or "general").strip().lower()
        if category not in HUB_CATEGORIES:
            category = "general"
        post_type = str((body or {}).get("postType") or "showcase").strip().lower()
        if post_type not in ("showcase", "help"):
            post_type = "showcase"
        raw_tags = (body or {}).get("tags") or []
        if isinstance(raw_tags, str):
            raw_tags = [t.strip() for t in raw_tags.split(",") if t.strip()]
        tags = [str(t).strip()[:30] for t in raw_tags if str(t).strip()][:8]
        thermo_method = str((body or {}).get("thermoMethod") or "AUTO").strip()[:32]
        unit_count = max(0, min(500, int((body or {}).get("unitCount") or 0)))
        stream_count = max(0, min(500, int((body or {}).get("streamCount") or 0)))
        mass_err = (body or {}).get("massErrorPct")
        mass_err_val = float(mass_err) if isinstance(mass_err, (int, float)) and math.isfinite(mass_err) else None
        converged = 1 if (body or {}).get("converged", True) else 0
        raw_fs = (body or {}).get("flowsheetJson")
        if isinstance(raw_fs, dict):
            fs_str = json.dumps(raw_fs, ensure_ascii=False)
        else:
            fs_str = str(raw_fs or "").strip()
        if not fs_str:
            raise HTTPException(status_code=400, detail="Flowsheet JSON payload is required.")
        if len(fs_str.encode("utf-8")) > MAX_HUB_JSON_BYTES:
            raise HTTPException(status_code=413, detail="Flowsheet payload exceeds 200 KB limit.")

        # Daily spam protection for non-admin users
        if user["role"] != "admin":
            today_prefix = utcnow().strftime("%Y-%m-%d")
            cnt = conn.execute(
                "SELECT COUNT(*) FROM hub_flowsheets WHERE author_id = ? AND created_at LIKE ?",
                (user["id"], f"{today_prefix}%"),
            ).fetchone()[0]
            if cnt >= MAX_HUB_DAILY_PUBLISH:
                raise HTTPException(status_code=429, detail=f"Daily publish limit ({MAX_HUB_DAILY_PUBLISH}) reached.")

        now = iso_now()
        is_official = 1 if (user["role"] == "admin" and (body or {}).get("asOfficial")) else 0
        if is_official:
            author_name = "ChemPlant Team"
        else:
            req_nick = sanitize_nickname((body or {}).get("authorName"))
            stored_nick = sanitize_nickname(user["display_name"])
            email_prefix = (user["email"] or user["username"] or "").split("@", 1)[0].strip().lower()
            if req_nick and len(req_nick) >= 2:
                author_name = req_nick
            elif stored_nick and stored_nick.lower() != email_prefix and len(stored_nick) >= 2:
                author_name = stored_nick
            else:
                author_name = generate_random_nickname()
            # Persist nickname to user profile so it's remembered next time
            if author_name and author_name != user["display_name"]:
                conn.execute(
                    "UPDATE users SET display_name = ? WHERE id = ?",
                    (author_name, user["id"]),
                )
        cur = conn.execute(
            """
            INSERT INTO hub_flowsheets (
                title, description, category, post_type, is_solved, tags_json, thermo_method,
                unit_count, stream_count, mass_error_pct, converged, is_official,
                preset_id, author_id, author_name, flowsheet_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
            """,
            (
                title,
                description,
                category,
                post_type,
                json.dumps(tags, ensure_ascii=False),
                thermo_method,
                unit_count,
                stream_count,
                mass_err_val,
                converged,
                is_official,
                user["id"],
                author_name,
                fs_str,
                now,
                now,
            ),
        )
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM hub_flowsheets WHERE id = ?", (new_id,)).fetchone()
        return {"ok": True, "item": _serialize_hub_row(row, include_json=False)}


@app.post("/api/hub/like/{item_id}")
def api_hub_like(item_id: int, request: Request):
    with get_db() as conn:
        _require_hub_access(request, conn, require_auth=True)
        row = conn.execute("SELECT id, likes FROM hub_flowsheets WHERE id = ? AND status = 'published'", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        conn.execute("UPDATE hub_flowsheets SET likes = likes + 1 WHERE id = ?", (item_id,))
        return {"ok": True, "likes": row["likes"] + 1}


@app.post("/api/hub/fork/{item_id}")
def api_hub_fork(item_id: int, request: Request):
    with get_db() as conn:
        _require_hub_access(request, conn, require_auth=False)
        row = conn.execute("SELECT id, forks FROM hub_flowsheets WHERE id = ? AND status = 'published'", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        conn.execute("UPDATE hub_flowsheets SET forks = forks + 1 WHERE id = ?", (item_id,))
        return {"ok": True, "forks": row["forks"] + 1}


@app.delete("/api/hub/item/{item_id}")
def api_hub_delete(item_id: int, request: Request):
    with get_db() as conn:
        user = _require_hub_access(request, conn, require_auth=True)
        assert user is not None
        row = conn.execute("SELECT id, author_id FROM hub_flowsheets WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        if user["role"] != "admin" and row["author_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Only the author or admin can delete this item.")
        conn.execute("DELETE FROM hub_flowsheets WHERE id = ?", (item_id,))
        return {"ok": True, "deletedId": item_id}


@app.get("/api/hub/item/{item_id}/replies")
def api_hub_list_replies(item_id: int, request: Request):
    with get_db() as conn:
        _require_hub_access(request, conn, require_auth=False)
        rows = conn.execute(
            "SELECT * FROM hub_replies WHERE hub_id = ? ORDER BY id ASC LIMIT 100",
            (item_id,),
        ).fetchall()
        return {
            "ok": True,
            "replies": [
                {
                    "id": r["id"],
                    "hubId": r["hub_id"],
                    "authorId": r["author_id"],
                    "authorName": r["author_name"],
                    "isOfficial": bool(r["is_official"]),
                    "message": r["message"],
                    "fixedUrl": r["fixed_url"] or "",
                    "createdAt": r["created_at"],
                }
                for r in rows
            ],
        }


@app.post("/api/hub/item/{item_id}/replies")
async def api_hub_add_reply(item_id: int, request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")
    message = str((body or {}).get("message") or "").strip()[:1500]
    if len(message) < 2:
        raise HTTPException(status_code=400, detail="Reply message must be at least 2 characters.")
    fixed_url = str((body or {}).get("fixedUrl") or "").strip()[:300]
    if fixed_url and not (fixed_url.startswith("https://chemplantstudio.com/") or fixed_url.startswith("/flowsheet-simulator")):
        fixed_url = ""
    with get_db() as conn:
        user = _require_hub_access(request, conn, require_auth=True)
        assert user is not None
        exists = conn.execute("SELECT id FROM hub_flowsheets WHERE id = ? AND status = 'published'", (item_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Shared flowsheet not found.")
        if user["role"] != "admin":
            today_prefix = utcnow().strftime("%Y-%m-%d")
            cnt = conn.execute(
                "SELECT COUNT(*) FROM hub_replies WHERE author_id = ? AND created_at LIKE ?",
                (user["id"], f"{today_prefix}%"),
            ).fetchone()[0]
            if cnt >= 30:
                raise HTTPException(status_code=429, detail="Daily reply limit (30) reached.")
        is_official = 1 if user["role"] == "admin" else 0
        if is_official:
            author_name = "ChemPlant Team"
        else:
            req_nick = sanitize_nickname((body or {}).get("authorName"))
            stored_nick = sanitize_nickname(user["display_name"])
            email_prefix = (user["email"] or user["username"] or "").split("@", 1)[0].strip().lower()
            if req_nick and len(req_nick) >= 2:
                author_name = req_nick
            elif stored_nick and stored_nick.lower() != email_prefix and len(stored_nick) >= 2:
                author_name = stored_nick
            else:
                author_name = generate_random_nickname()
            if author_name != user["display_name"]:
                conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (author_name, user["id"]))
        now = iso_now()
        cur = conn.execute(
            """
            INSERT INTO hub_replies (hub_id, author_id, author_name, is_official, message, fixed_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (item_id, user["id"], author_name, is_official, message, fixed_url, now),
        )
        new_id = cur.lastrowid
        r = conn.execute("SELECT * FROM hub_replies WHERE id = ?", (new_id,)).fetchone()
        return {
            "ok": True,
            "reply": {
                "id": r["id"],
                "hubId": r["hub_id"],
                "authorId": r["author_id"],
                "authorName": r["author_name"],
                "isOfficial": bool(r["is_official"]),
                "message": r["message"],
                "fixedUrl": r["fixed_url"] or "",
                "createdAt": r["created_at"],
            },
        }


@app.post("/api/hub/item/{item_id}/solve")
def api_hub_toggle_solve(item_id: int, request: Request):
    with get_db() as conn:
        user = _require_hub_access(request, conn, require_auth=True)
        assert user is not None
        row = conn.execute("SELECT id, author_id, is_solved FROM hub_flowsheets WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        if user["role"] != "admin" and row["author_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Only the author or admin can mark solved.")
        next_val = 0 if row["is_solved"] else 1
        conn.execute("UPDATE hub_flowsheets SET is_solved = ?, updated_at = ? WHERE id = ?", (next_val, iso_now(), item_id))
        return {"ok": True, "isSolved": bool(next_val)}


@app.delete("/api/hub/reply/{reply_id}")
def api_hub_delete_reply(reply_id: int, request: Request):
    with get_db() as conn:
        user = _require_hub_access(request, conn, require_auth=True)
        assert user is not None
        row = conn.execute("SELECT id, author_id FROM hub_replies WHERE id = ?", (reply_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        if user["role"] != "admin" and row["author_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Only the author or admin can delete this reply.")
        conn.execute("DELETE FROM hub_replies WHERE id = ?", (reply_id,))
        return {"ok": True, "deletedId": reply_id}


@app.post("/api/auth/me/nickname")
async def api_update_my_nickname(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")
    raw = str((body or {}).get("nickname") or "").strip()
    if "@" in raw:
        raise HTTPException(status_code=400, detail="Nickname cannot be an email address.")
    nick = sanitize_nickname(raw)
    if len(nick) < 2:
        raise HTTPException(status_code=400, detail="Nickname must be at least 2 characters.")
    with get_db() as conn:
        user = resolve_session_user(request, conn)
        if not user:
            raise HTTPException(status_code=401, detail="Login required.")
        conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (nick, user["id"]))
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return {"ok": True, "nickname": nick, "user": serialize_user(updated)}


@app.get("/{full_path:path}")
def serve_static_frontend(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")

    if not OUT_DIR.exists():
        return JSONResponse(
            {"detail": "프론트엔드 빌드(out/)가 아직 준비되지 않았습니다."},
            status_code=503,
        )

    trimmed = full_path.strip("/")
    candidates: list[str] = []
    if not trimmed:
        candidates = ["index.html"]
    else:
        candidates = [
            trimmed,
            f"{trimmed}.html",
            f"{trimmed}/index.html",
            "index.html",
        ]

    for rel in candidates:
        fp = _safe_out_path(rel)
        if fp and fp.is_file():
            headers: dict[str, str] = {}
            media_type: Optional[str] = None
            if rel == "manifest.json":
                media_type = "application/manifest+json"
                headers["Cache-Control"] = "no-cache, must-revalidate"
            elif rel == "sw.js":
                media_type = "application/javascript"
                headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                headers["Service-Worker-Allowed"] = "/"
            elif rel.endswith(".html"):
                headers["Cache-Control"] = "no-store, must-revalidate"
            elif "_next/static/" in rel:
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return FileResponse(str(fp), headers=headers, media_type=media_type)

    raise HTTPException(status_code=404, detail="Not Found")
