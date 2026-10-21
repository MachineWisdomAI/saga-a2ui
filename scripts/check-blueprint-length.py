#!/usr/bin/env python3
"""Warn about long changed Blueprints; length never determines approval."""
import argparse
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="origin/main")
    args = parser.parse_args()
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=ACMR", "-z",
             args.base, "--", "blueprints/"],
            check=True, capture_output=True,
        )
    except subprocess.CalledProcessError:
        print("Blueprint length check unavailable: comparison history is missing.")
        return
    for name in result.stdout.decode().split("\0"):
        path = Path(name)
        if (len(path.parts) != 3 or path.parts[1] not in {"features", "modules"}
                or not name.endswith(".blueprint.md")):
            continue
        text = path.read_text(encoding="utf-8")
        text = re.sub(r"\A---\r?\n.*?\r?\n---(?:\r?\n|\Z)", "", text, count=1, flags=re.S)
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        words = len(text.split())
        if words > 1000:
            file = name.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            file = file.replace(":", "%3A").replace(",", "%2C")
            print(f"::warning file={file}::{words} words. Review scope and repetition; "
                  "retain detail needed to understand the design. This is advisory.")


if __name__ == "__main__":
    main()
