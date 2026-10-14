#!/usr/bin/env python3
"""Reject owned npm versions without MachineWisdom version-policy enrollment."""
import json
from pathlib import Path
import subprocess
import sys

root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
owned = [p for p in paths if p == "package.json" or
         (p.startswith(("apps/", "packages/")) and p.endswith("/package.json") and len(Path(p).parts) == 3)]
versioned = [p for p in owned if "version" in json.loads((root / p).read_text())]
if not versioned:
    print("No owned npm version; no software bump required")
    sys.exit(0)
required = [".version-policy.json", "scripts/mw-version.py", ".github/workflows/version-policy.yml", "docs/version-policy.md"]
missing = [p for p in required if p not in paths]
if missing:
    sys.exit("Enroll owned versions before review; missing: " + ", ".join(missing))
config = json.loads((root / ".version-policy.json").read_text())
registered = {f["path"] for u in config.get("units", []) for f in u.get("files", [])
              if f.get("kind") == "json" and f.get("key", ["version"]) == ["version"]}
missing = sorted(set(versioned) - registered)
if missing:
    sys.exit("Enroll version owners or mirrors: " + ", ".join(missing))
print("Owned npm versions are enrolled; the Version policy workflow checks bumps")
