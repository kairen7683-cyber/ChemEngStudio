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
        """
    )

    try:
        conn.execute("ALTER TABLE users ADD COLUMN allowed_plants TEXT DEFAULT NULL")
    except sqlite3.OperationalError as exc:
        if "duplicate column name" not in str(exc).lower():
            raise

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
    raw_allowed = row["allowed_plants"] if "allowed_plants" in row.keys() else None
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "status": row["status"],
        "allowed_plants": parse_allowed_plants(raw_allowed),
        "daily_ai_count": row["daily_ai_count"],
        "last_login_at": row["last_login_at"],
        "created_at": row["created_at"],
    }


def resolve_session_user(request: Request, conn: sqlite3.Connection) -> Optional[sqlite3.Row]:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        return None
    t_hash = hash_token(raw_token)
    now_iso = iso_now()
    row = conn.execute(
        """
        SELECT u.*
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
        """,
        (t_hash, now_iso),
    ).fetchone()
    if not row or row["status"] != "active":
        return None
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
    conn: sqlite3.Connection, user_id: int, request: Request, remember_me: bool = True
) -> str:
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
        INSERT INTO sessions(token_hash, user_id, expires_at, ip_addr, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            t_hash,
            user_id,
            exp,
            client_ip(request),
            request.headers.get("user-agent", "")[:240],
            iso_now(),
        ),
    )
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (iso_now(), user_id))
    return raw_token


# ── Pydantic Models ─────────────────────────────────────────────────────
class LoginPayload(BaseModel):
    username: str
    password: str
    remember_me: bool = True


class RegisterPayload(BaseModel):
    username: str
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
    username: str
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
def api_auth_me(user: sqlite3.Row = Depends(require_active_user)):
    return {"user": serialize_user(user)}


@app.post("/api/auth/login")
def api_auth_login(payload: LoginPayload, request: Request, response: Response):
    ip = client_ip(request)
    check_auth_rate_limit(ip)
    uname = payload.username.strip()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (uname,)).fetchone()
        if not row or not verify_password(payload.password, row["password_hash"]):
            record_auth_failure(ip)
            raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
        if row["status"] == "pending":
            raise HTTPException(status_code=403, detail="관리자 승인 대기 중인 계정입니다.")
        if row["status"] != "active":
            raise HTTPException(status_code=403, detail="비활성화(정지)된 계정입니다. 관리자에게 문의하세요.")
        clear_auth_failures(ip)
        raw_token = create_session_for_user(conn, row["id"], request, remember_me=payload.remember_me)
        set_session_cookie(response, request, raw_token, remember_me=payload.remember_me)
        refreshed = conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
        return {"user": serialize_user(refreshed)}


@app.post("/api/auth/register")
def api_auth_register(payload: RegisterPayload, request: Request, response: Response):
    ip = client_ip(request)
    check_auth_rate_limit(ip)
    uname = payload.username.strip()
    dname = payload.display_name.strip() or uname
    if not USERNAME_RE.match(uname):
        raise HTTPException(
            status_code=400,
            detail="아이디는 3~32자의 영문·숫자·밑줄(_), 하이픈(-), 점(.)만 가능합니다.",
        )
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 6자 이상이어야 합니다.")

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (uname,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")

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

        cur = conn.execute(
            """
            INSERT INTO users(username, display_name, password_hash, role, status, created_at)
            VALUES (?, ?, ?, 'user', ?, ?)
            """,
            (uname, dname, hash_password(payload.password), new_status, iso_now()),
        )
        new_id = cur.lastrowid
        new_user = conn.execute("SELECT * FROM users WHERE id = ?", (new_id,)).fetchone()
        if new_status == "active":
            raw_token = create_session_for_user(conn, new_id, request, remember_me=payload.remember_me)
            set_session_cookie(response, request, raw_token, remember_me=payload.remember_me)
        clear_auth_failures(ip)
        return {"status": new_status, "message": msg, "user": serialize_user(new_user)}


@app.post("/api/auth/logout")
def api_auth_logout(request: Request, response: Response):
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if raw_token:
        t_hash = hash_token(raw_token)
        with get_db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (t_hash,))
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
@app.get("/api/admin/overview")
def api_admin_overview(_admin: Optional[sqlite3.Row] = Depends(require_admin_or_master)):
    with get_db() as conn:
        reg_mode = get_setting(conn, "registration_mode", "invite_only")
        ai_limit = int(get_setting(conn, "daily_ai_limit", "30") or "30")
        has_gemini = bool(get_setting(conn, "gemini_api_key", "").strip())

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
                }
                for r in user_rows
            ]
        }


@app.post("/api/admin/users")
def api_admin_create_user(
    payload: AdminCreateUserPayload,
    _admin: Optional[sqlite3.Row] = Depends(require_admin_or_master),
):
    uname = payload.username.strip()
    if not USERNAME_RE.match(uname):
        raise HTTPException(status_code=400, detail="유효하지 않은 아이디 형식입니다.")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 6자 이상이어야 합니다.")
    dname = payload.display_name.strip() or uname
    allowed_db = (
        None
        if payload.role == "admin"
        else normalize_allowed_plants_for_db(payload.allowed_plants)
    )
    with get_db() as conn:
        exists = conn.execute("SELECT id FROM users WHERE username = ?", (uname,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="이미 존재하는 아이디입니다.")
        cur = conn.execute(
            """
            INSERT INTO users(username, display_name, password_hash, role, status, allowed_plants, created_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?)
            """,
            (uname, dname, hash_password(payload.password), payload.role, allowed_db, iso_now()),
        )
        created = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        return {
            "ok": True,
            "user_id": cur.lastrowid,
            "user": serialize_user(created) if created else None,
        }


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
