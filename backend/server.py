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
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

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
        """
    )

    _ensure_column(conn, "users", "allowed_plants TEXT DEFAULT NULL")
    _ensure_column(conn, "users", "email TEXT DEFAULT ''")
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
    return {
        "id": row["id"],
        "username": row["username"],
        "email": raw_email or "",
        "display_name": row["display_name"],
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
    invite_code: Optional[str] = None
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


class AdminUpdateFeedbackPayload(BaseModel):
    status: Optional[Literal["new", "in_progress", "done"]] = None
    admin_note: Optional[str] = None


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


@app.post("/api/auth/register")
def api_auth_register(payload: RegisterPayload, request: Request, response: Response):
    ip = client_ip(request)
    check_auth_rate_limit(ip)
    uname, email_val = _normalize_username_and_email(payload.username, payload.email)
    dname = payload.display_name.strip() or (uname.split("@")[0] if "@" in uname else uname)
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
        cur = conn.execute(
            """
            INSERT INTO users(username, email, display_name, password_hash, role, status, allowed_plants, created_at)
            VALUES (?, ?, ?, ?, 'user', ?, ?, ?)
            """,
            (
                uname,
                email_val,
                dname,
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
                            "당신은 화학공정 장치설계 수석 엔지니어입니다. 아래 공정·장치 해석 요약을 보고 "
                            "실무 핵심 진단과 개선 조치 2~3줄만 한국어로 간결히 작성하세요.\n\n"
                            + prompt
                        )
                    }
                ]
            }
        ],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 260},
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
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
        sync_feedback_backlog_md(conn)
    return {"ok": True, "id": new_id}


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
