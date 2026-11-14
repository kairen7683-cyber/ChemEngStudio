#!/usr/bin/env python3
"""Remote Windows SSH wrapper for ChemEng Studio Admin CLI on GCP (34.47.91.5)."""

from __future__ import annotations

import shlex
import subprocess
import sys

GCP_HOST = "kairen7683@34.47.91.5"
REMOTE_PY = "/home/kairen7683/chemeng-studio/venv/bin/python"
REMOTE_SCRIPT = "/home/kairen7683/chemeng-studio/scripts/chemeng_admin.py"


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/chemeng_cloud_admin.py <overview|set-mode|create-invite|create-user|...> [args...]")
        return 1
    quoted_args = " ".join(shlex.quote(a) for a in sys.argv[1:])
    remote_cmd = f"{REMOTE_PY} {REMOTE_SCRIPT} {quoted_args}"
    proc = subprocess.run(["ssh", "-o", "BatchMode=yes", GCP_HOST, remote_cmd])
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
