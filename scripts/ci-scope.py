#!/usr/bin/env python3
"""Route CI without installing the application. Unknown changes run everything."""
import argparse
import os
from pathlib import Path
import subprocess


# These files have a Python-only qualification in CI and Version policy.
POLICY_PATHS = {
    ".github/workflows/version-policy.yml", ".version-policy.json",
    "scripts/mw-version.py", "scripts/test-version-enrollment.py",
    "scripts/check-version-enrollment.py",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"}


def documentation_path(name):
    path = Path(name)
    # This artwork is executable input to publication packages, not a documentation illustration.
    if name == "assets/brand/plugin-icon.svg":
        return False
    # Retained evidence and generated deliverables may need executable qualification.
    if name.startswith(("docs/evidence/", "docs/artifacts/")):
        return False
    if path.suffix.lower() == ".md":
        # Source/fixture Markdown can be runtime input. Conventional readmes and
        # changelogs remain documentation even alongside source.
        return (len(path.parts) == 1
                or name.startswith(("docs/", "blueprints/", "diagrams/"))
                or path.name.lower() in {"readme.md", "changelog.md"})
    return (name.startswith(("assets/brand/", "docs/", "diagrams/"))
            and path.suffix.lower() in IMAGE_SUFFIXES)


def scope(event, base, head):
    if event not in {"pull_request", "push"} or not base:
        return "full"
    args = ["git", "diff", "--no-renames", "--name-only", "-z"]
    if event == "pull_request":
        args.append("--merge-base")
    try:
        result = subprocess.run([*args, base, head, "--"], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        # Missing history (including a first push) never becomes an exemption.
        print("Changed paths unavailable; retaining full qualification.")
        return "full"
    names = result.stdout.decode("utf-8", errors="surrogateescape").rstrip("\0").split("\0")
    if not names or not names[0]:
        return "full"
    if all(documentation_path(name) for name in names):
        return "docs"
    if all(documentation_path(name) or name in POLICY_PATHS for name in names):
        return "policy"
    return "full"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True)
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="HEAD")
    args = parser.parse_args()
    selected = scope(args.event, args.base, args.head)
    result = f"scope={selected}\napplication={'true' if selected == 'full' else 'false'}\n"
    print(result, end="")
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a") as stream:
            stream.write(result)


if __name__ == "__main__":
    main()
