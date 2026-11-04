#!/usr/bin/env python3
"""Reject executable workflow actions that are not pinned to an immutable revision.

Every `uses:` reference in `.github/workflows` and `.github/actions` must be a
local path (`./...`), a Docker image with a `@sha256:` digest, or a repository
action pinned to a full 40-character commit SHA. Branch and tag references,
including major-version tags, can move after review and are rejected.
"""
import argparse
from pathlib import Path
import re
import subprocess
import sys

USES = re.compile(r"""^\s*(?:-\s+)?["']?uses["']?\s*:\s*(?P<value>.*?)\s*$""")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
DOCKER_DIGEST = re.compile(r"^docker://[^@\s]+@sha256:[0-9a-f]{64}$")
SCOPES = (".github/workflows/", ".github/actions/")
SUFFIXES = (".yml", ".yaml")


def reference(value):
    """Return the unquoted reference, dropping a trailing YAML comment."""
    value = value.strip()
    if value[:1] in {"'", '"'}:
        end = value.find(value[0], 1)
        return value[1:end] if end > 0 else value[1:]
    return value.split(" #", 1)[0].split("\t#", 1)[0].strip()


def violation(ref):
    """Return why `ref` is not immutable, or None when it is acceptable."""
    if not ref:
        return "has no action reference"
    if ref.startswith(("./", "../")):
        return None
    if ref.startswith("docker://"):
        if DOCKER_DIGEST.match(ref):
            return None
        return "uses a Docker image without a @sha256 digest"
    name, separator, revision = ref.rpartition("@")
    if not separator or not name:
        return "has no pinned revision"
    if not FULL_SHA.match(revision):
        return f"uses mutable revision '{revision}' instead of a full 40-character commit SHA"
    return None


def scan(name, text):
    """Yield (line number, reference, reason) for each unpinned reference."""
    for number, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue
        match = USES.match(line)
        if not match:
            continue
        ref = reference(match.group("value"))
        reason = violation(ref)
        if reason:
            yield number, ref, reason


def tracked_workflow_files(root):
    output = subprocess.check_output(["git", "ls-files", "-z", "--", ".github"], cwd=root)
    names = output.decode("utf-8", errors="surrogateescape").split("\0")
    return sorted(n for n in names if n.startswith(SCOPES) and n.endswith(SUFFIXES))


def check(root):
    problems = []
    names = tracked_workflow_files(root)
    for name in names:
        text = (root / name).read_text(encoding="utf-8")
        for number, ref, reason in scan(name, text):
            problems.append(f"{name}:{number}: '{ref}' {reason}")
    return names, problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    names, problems = check(root)
    if problems:
        print("Workflow actions must be pinned to a reviewed full commit SHA:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"All executable workflow actions in {len(names)} files are immutably pinned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
