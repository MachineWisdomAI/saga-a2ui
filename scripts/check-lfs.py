#!/usr/bin/env python3
"""Check staged LFS paths, not hydrated working-tree files. Requires git-lfs."""
import subprocess
import sys


def git(*args, **kwargs):
    return subprocess.check_output(["git", *args], **kwargs)


def main():
    git("lfs", "version")
    paths = git("ls-files", "-z")
    attributes = git("check-attr", "--cached", "-z", "--stdin", "filter", input=paths).split(b"\0")
    failures = []
    count = 0
    for path, _, value in zip(attributes[0::3], attributes[1::3], attributes[2::3]):
        if value != b"lfs":
            continue
        count += 1
        name = path.decode("utf-8", errors="surrogateescape")
        ref = ":" + name
        # Bound reads even if a large binary was accidentally staged directly.
        size = int(git("cat-file", "-s", ref))
        valid = size <= 1024 and subprocess.run(
            ["git", "lfs", "pointer", "--check", "--strict", "--stdin"],
            input=git("cat-file", "blob", ref), capture_output=True,
        ).returncode == 0
        if not valid:
            failures.append(name)
    if failures:
        print("Stage these files through Git LFS, then rerun:", file=sys.stderr)
        for name in failures:
            print(repr(name), file=sys.stderr)
        return 1
    print(f"LFS pointers valid: {count} tracked artifact(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
