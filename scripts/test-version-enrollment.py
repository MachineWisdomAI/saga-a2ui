"""First enrollment of an existing unversioned package, then an ordinary bump."""
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


if __name__ == "__main__":
    unittest.main()
