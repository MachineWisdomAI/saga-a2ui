"""Version enrollment and explicit PR intent through real Git repositories."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

UPDATER = Path(__file__).with_name("mw-version.py")


class EnrollmentTest(unittest.TestCase):
    def test_existing_unversioned_manifest_gets_initial_version_then_bumps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def run(*args):
                return subprocess.check_output(args, cwd=root, text=True, stderr=subprocess.STDOUT)

            run("git", "init", "-b", "feature")
            run("git", "config", "user.name", "Test")
            run("git", "config", "user.email", "test@example.invalid")
            package = root / "package.json"
            package.write_text('{"name":"fixture","private":true}\n')
            run("git", "add", "package.json")
            run("git", "commit", "-m", "chore: initial unversioned package")
            base = run("git", "rev-parse", "HEAD").strip()
            package.write_text('{"name":"fixture","version":"0.1.0-rc.1"}\n')
            (root / ".version-policy.json").write_text(json.dumps({
                "schema_version": 1,
                "units": [{"name": "package", "paths": ["**"],
                           "files": [{"path": "package.json", "kind": "json"}]}],
            }))

            def update(command, revision):
                run(sys.executable, str(UPDATER), command, "--repo", directory,
                    "--base", revision, "--title", "fix: package correction")

            update("update", base)
            update("check", base)
            self.assertEqual(json.loads(package.read_text())["version"], "0.1.0-rc.1")
            run("git", "add", "package.json", ".version-policy.json")
            run("git", "commit", "-m", "feat: enroll package")
            enrolled = run("git", "rev-parse", "HEAD").strip()
            for name in ["README.md", "packages/core/README.MD", "docs/setup.md",
                         "assets/brand/banner.png", "docs/images/flow.svg",
                         "scripts/starter-qualification.ts"]:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("documentation")
            update("update", enrolled)
            update("check", enrolled)
            self.assertEqual(json.loads(package.read_text())["version"], "0.1.0-rc.1")
            # A runtime asset mixed with documentation must still trigger a bump.
            asset = root / "src/icon.png"
            asset.parent.mkdir(parents=True, exist_ok=True)
            asset.write_text("runtime image")
            update("update", enrolled)
            update("check", enrolled)
            self.assertNotEqual(json.loads(package.read_text())["version"], "0.1.0-rc.1")
            asset.unlink()
            package.write_text('{"name":"fixture","version":"0.1.0-rc.1"}\n')
            (root / "implementation.txt").write_text("changed")
            update("update", enrolled)
            update("check", enrolled)
            self.assertNotEqual(json.loads(package.read_text())["version"], "0.1.0-rc.1")


class VersionIntentTest(unittest.TestCase):
    def test_explicit_patch_for_additive_pr_preserves_breaking_detection(self):
        for footer, subject, expected in [
            ("", "feat: add server target", "0.7.0-rc.1"),
            ("Version-Bump: patch", "feat: add server target", "0.6.1-rc.1"),
            ("Version-Bump: patch", "feat!: change public API", "0.7.0-rc.1"),
            ("Version-Bump: patch", "feat: change API\n\nBREAKING CHANGE: required argument", "0.7.0-rc.1"),
        ]:
            with self.subTest(subject=subject, footer=footer), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "repo"
                root.mkdir()

                def run(*args):
                    return subprocess.check_output(args, cwd=root, text=True, stderr=subprocess.STDOUT)

                run("git", "init", "-b", "feature")
                run("git", "config", "user.name", "Test")
                run("git", "config", "user.email", "test@example.invalid")
                package = root / "package.json"
                package.write_text('{"name":"fixture","version":"0.6.0-rc.1"}\n')
                (root / ".version-policy.json").write_text(json.dumps({
                    "schema_version": 1,
                    "units": [{"name": "package", "paths": ["**"],
                               "files": [{"path": "package.json", "kind": "json"}]}],
                }))
                (root / "server.ts").write_text("original")
                run("git", "add", "package.json", ".version-policy.json", "server.ts")
                run("git", "commit", "-m", "chore: baseline")
                base = run("git", "rev-parse", "HEAD").strip()
                (root / "server.ts").write_text("additive server target")
                run("git", "add", "server.ts")
                run("git", "commit", "-m", subject)
                event = Path(directory) / "event.json"
                event.write_text(json.dumps({"pull_request": {
                    "title": "feat: add server target", "body": footer,
                }}))
                for command in ["update", "check"]:
                    run(sys.executable, str(UPDATER), command, "--repo", str(root),
                        "--base", base, "--event-file", str(event))
                self.assertEqual(json.loads(package.read_text())["version"], expected)


if __name__ == "__main__":
    unittest.main()
