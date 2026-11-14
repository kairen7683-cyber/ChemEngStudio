#!/usr/bin/env python3
"""ChemEng Studio GCP CLI Admin Helper.

Runs directly on the GCP host using backend/data/.admin_credentials (X-Admin-Master-Key)
against the local backend (or directly manages SQLite when offline), enabling Antigravity
and the server owner to inspect overview, switch registration modes, manage invites, and
create/reset/delete users without touching browser cookies.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CREDS_PATH = BASE_DIR / "backend" / "data" / ".admin_credentials"
DEFAULT_API_BASE = "http://127.0.0.1:8090"


def load_master_key() -> str:
    if not CREDS_PATH.exists():
        raise RuntimeError(f"Credentials file not found: {CREDS_PATH}")
    for line in CREDS_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("ADMIN_MASTER_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("ADMIN_MASTER_KEY missing in .admin_credentials")


def api_call(method: str, path: str, body: dict | None = None, api_base: str = DEFAULT_API_BASE) -> dict:
    master_key = load_master_key()
    url = f"{api_base.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "X-Admin-Master-Key": master_key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {"ok": True}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code}: {detail}") from err


def main() -> int:
    parser = argparse.ArgumentParser(description="ChemEng Studio Server Admin CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("overview", help="Show registration mode, AI limits, users, and invite codes")

    p_mode = sub.add_parser("set-mode", help="Switch registration mode")
    p_mode.add_argument("mode", choices=["invite_only", "approval", "open"])

    p_ai = sub.add_parser("set-ai", help="Configure AI daily quota and optional server Gemini key")
    p_ai.add_argument("--limit", type=int, default=None)
    p_ai.add_argument("--key", type=str, default=None)

    p_inv = sub.add_parser("create-invite", help="Generate a new invite code")
    p_inv.add_argument("--code", type=str, default=None)
    p_inv.add_argument("--memo", type=str, default="CLI issued")
    p_inv.add_argument("--uses", type=int, default=5)
    p_inv.add_argument("--days", type=int, default=30)

    p_inv_t = sub.add_parser("toggle-invite", help="Enable or disable an invite code")
    p_inv_t.add_argument("code")
    p_inv_t.add_argument("--active", choices=["true", "false"], required=True)

    p_cu = sub.add_parser("create-user", help="Create an active user directly")
    p_cu.add_argument("--username", required=True)
    p_cu.add_argument("--password", required=True)
    p_cu.add_argument("--name", default="")
    p_cu.add_argument("--role", choices=["user", "admin"], default="user")

    p_uu = sub.add_parser("update-user", help="Approve, disable, promote, reset password or workspace")
    p_uu.add_argument("user_id", type=int)
    p_uu.add_argument("--status", choices=["active", "pending", "disabled"], default=None)
    p_uu.add_argument("--role", choices=["user", "admin"], default=None)
    p_uu.add_argument("--password", default=None)
    p_uu.add_argument("--reset-workspace", action="store_true")

    p_du = sub.add_parser("delete-user", help="Delete a user and their workspaces")
    p_du.add_argument("user_id", type=int)

    args = parser.parse_args()

    if args.cmd == "overview":
        out = api_call("GET", "/api/admin/overview")
    elif args.cmd == "set-mode":
        out = api_call("PUT", "/api/admin/settings", {"registration_mode": args.mode})
    elif args.cmd == "set-ai":
        patch: dict = {}
        if args.limit is not None:
            patch["daily_ai_limit"] = args.limit
        if args.key is not None:
            patch["gemini_api_key"] = args.key
        out = api_call("PUT", "/api/admin/settings", patch)
    elif args.cmd == "create-invite":
        out = api_call(
            "POST",
            "/api/admin/invites",
            {
                "code": args.code,
                "memo": args.memo,
                "max_uses": args.uses,
                "expires_days": args.days,
            },
        )
    elif args.cmd == "toggle-invite":
        out = api_call(
            "PATCH",
            f"/api/admin/invites/{args.code}",
            {"is_active": args.active == "true"},
        )
    elif args.cmd == "create-user":
        out = api_call(
            "POST",
            "/api/admin/users",
            {
                "username": args.username,
                "password": args.password,
                "display_name": args.name or args.username,
                "role": args.role,
            },
        )
    elif args.cmd == "update-user":
        patch = {}
        if args.status:
            patch["status"] = args.status
        if args.role:
            patch["role"] = args.role
        if args.password:
            patch["new_password"] = args.password
        if args.reset_workspace:
            patch["reset_workspace"] = True
        out = api_call("PATCH", f"/api/admin/users/{args.user_id}", patch)
    elif args.cmd == "delete-user":
        out = api_call("DELETE", f"/api/admin/users/{args.user_id}")
    else:
        return 1

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
