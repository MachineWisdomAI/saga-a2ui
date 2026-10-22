"""Version enrollment and explicit PR intent through real Git repositories."""
import importlib.util
import json
import os
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


UNITS = ["core", "components", "mcp", "react"]
INTEGRATION_BASE = "feat/v0.7-composition"
PIN = {"base": INTEGRATION_BASE, "version": "0.7.0-rc.1"}


class PackageRepo:
    """A throwaway repository shaped like the SDK: four versioned units, one sibling mirror."""

    def __init__(self, directory):
        self.root = Path(directory) / "repo"
        self.root.mkdir()
        self.event = Path(directory) / "event.json"
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True, stderr=subprocess.STDOUT).strip()

    def write_state(self, versions, integration=None):
        units = []
        for name in UNITS:
            manifest = {"name": f"@saga-a2ui/{name}", "version": versions[name]}
            if name == "components":
                manifest["dependencies"] = {"@saga-a2ui/core": versions["core"]}
            self.write(f"packages/{name}/package.json", json.dumps(manifest, indent=2) + "\n")
            files = [{"path": f"packages/{name}/package.json", "kind": "json"}]
            if name == "core":
                files.append({"path": "packages/components/package.json", "kind": "json",
                              "key": ["dependencies", "@saga-a2ui/core"]})
            units.append({"name": f"packages/{name}", "paths": [f"packages/{name}/**"], "files": files})
        config = {"schema_version": 1, "units": units}
        if integration is not None:
            config["integration"] = integration
        self.write(".version-policy.json", json.dumps(config, indent=2) + "\n")

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def versions(self):
        return {name: json.loads((self.root / f"packages/{name}/package.json").read_text())["version"]
                for name in UNITS}

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_text()
                for p in sorted(self.root.rglob("*")) if p.is_file() and ".git" not in p.relative_to(self.root).parts}

    def commit(self, message):
        self.git("add", "--", *self.snapshot())
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def track(self, branch, revision):
        self.git("update-ref", f"refs/remotes/origin/{branch}", revision)

    def run(self, command, base, title, base_ref=None, *extra):
        args = [sys.executable, str(UPDATER), command, "--repo", str(self.root), "--base", base, "--title", title]
        if base_ref is not None:
            self.event.write_text(json.dumps({"pull_request": {"title": title, "body": "", "base": {"ref": base_ref}}}))
            args += ["--event-file", str(self.event)]
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_EVENT_PATH"}
        return subprocess.run([*args, *extra], capture_output=True, text=True, env=env)


def baseline(directory, versions=None, docs="docs/note.md"):
    repo = PackageRepo(directory)
    repo.write_state(versions or dict.fromkeys(UNITS, "0.6.4-rc.1"))
    repo.write(docs, "documentation")
    repo.commit("chore: baseline")
    repo.track("main", repo.git("rev-parse", "HEAD"))
    repo.git("switch", "-c", "change")
    return repo


class SharedMajorMinorTest(unittest.TestCase):
    def test_feature_in_one_unit_advances_every_unit_minor(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = baseline(directory)
            repo.write("packages/core/src.ts", "feature")
            for command in ["update", "check"]:
                result = repo.run(command, "refs/remotes/origin/main", "feat: add core feature")
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(repo.versions(), dict.fromkeys(UNITS, "0.7.0-rc.1"))
            manifest = json.loads((repo.root / "packages/components/package.json").read_text())
            self.assertEqual(manifest["dependencies"]["@saga-a2ui/core"], "0.7.0-rc.1")

    def test_fix_in_one_unit_advances_only_that_unit_patch(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = baseline(directory)
            repo.write("packages/core/src.ts", "fix")
            for command in ["update", "check"]:
                result = repo.run(command, "refs/remotes/origin/main", "fix: correct core")
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(repo.versions(), {"core": "0.6.5-rc.1", "components": "0.6.4-rc.1",
                                               "mcp": "0.6.4-rc.1", "react": "0.6.4-rc.1"})

    def test_prerelease_minor_advance_resets_every_unit(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = baseline(directory, {"core": "0.6.4-rc.3", "components": "0.6.0-rc.2",
                                        "mcp": "0.6.9-rc.7", "react": "0.6.1-rc.1"})
            repo.write("packages/mcp/src.ts", "feature")
            result = repo.run("update", "refs/remotes/origin/main", "feat: add connector feature")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(repo.versions(), dict.fromkeys(UNITS, "0.7.0-rc.1"))
            self.assertEqual(repo.run("check", "refs/remotes/origin/main", "feat: add connector feature").returncode, 0)

    def test_check_names_units_that_differ_in_major_minor(self):
        for versions, passes in [
            ({"core": "0.7.0", "components": "0.6.4", "mcp": "0.7.0", "react": "0.7.0"}, False),
            ({"core": "0.7.0", "components": "0.7.2", "mcp": "0.7.0", "react": "0.7.1"}, True),
        ]:
            with self.subTest(versions=versions), tempfile.TemporaryDirectory() as directory:
                repo = baseline(directory, versions)
                repo.write("docs/other.md", "documentation only")
                result = repo.run("check", "refs/remotes/origin/main", "docs: describe versions")
                if passes:
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertEqual(result.returncode, 1)
                    self.assertIn("packages/core", result.stderr)
                    self.assertIn("packages/components", result.stderr)
                    self.assertIn("major.minor", result.stderr)

    def test_update_refuses_to_hide_a_split_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = baseline(directory, {"core": "0.7.0", "components": "0.6.4", "mcp": "0.7.0", "react": "0.7.0"})
            repo.write("packages/core/src.ts", "fix")
            result = repo.run("update", "refs/remotes/origin/main", "fix: correct core")
            self.assertEqual(result.returncode, 1)
            self.assertIn("packages/components", result.stderr)


class IntegrationPinTest(unittest.TestCase):
    def integration(self, directory):
        """main at 0.6.4-rc.1; the integration branch already carries the pin at 0.7.0-rc.1."""
        repo = baseline(directory)
        repo.git("switch", "-c", "integration")
        repo.write_state(dict.fromkeys(UNITS, "0.7.0-rc.1"), PIN)
        repo.commit("feat!: introduce integration pin")
        repo.track(INTEGRATION_BASE, repo.git("rev-parse", "HEAD"))
        repo.git("switch", "-c", "child")
        return repo

    def run_child(self, repo, command, title="feat: add product behavior", **options):
        return repo.run(command, f"refs/remotes/origin/{INTEGRATION_BASE}", title, **options)

    def test_product_feature_child_keeps_the_pin_and_update_changes_nothing(self):
        for source in ["event", "base ref"]:
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                repo = self.integration(directory)
                repo.write("packages/core/src.ts", "product change")
                before = repo.snapshot()
                options = {"base_ref": INTEGRATION_BASE} if source == "event" else {}
                self.assertEqual(self.run_child(repo, "check", **options).returncode, 0)
                result = self.run_child(repo, "update", **options)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("0.7.0-rc.1", result.stdout)
                self.assertEqual(repo.snapshot(), before)

    def test_child_that_bumps_any_unit_fails_naming_the_pin(self):
        for name in UNITS:
            with self.subTest(unit=name), tempfile.TemporaryDirectory() as directory:
                repo = self.integration(directory)
                repo.write("packages/core/src.ts", "product change")
                versions = dict.fromkeys(UNITS, "0.7.0-rc.1")
                versions[name] = "0.7.1-rc.1"
                repo.write_state(versions, PIN)
                for command in ["check", "update"]:
                    result = self.run_child(repo, command)
                    self.assertEqual(result.returncode, 1, command)
                    self.assertIn("pin 0.7.0-rc.1", result.stderr)
                    self.assertIn(INTEGRATION_BASE, result.stderr)

    def test_child_that_changes_or_removes_the_entry_fails(self):
        for label, entry in [("version", {"base": INTEGRATION_BASE, "version": "0.7.0-rc.2"}),
                             ("base", {"base": "other", "version": "0.7.0-rc.1"}),
                             ("removed", None)]:
            with self.subTest(change=label), tempfile.TemporaryDirectory() as directory:
                repo = self.integration(directory)
                repo.write("packages/core/src.ts", "product change")
                versions = dict.fromkeys(UNITS, "0.7.0-rc.1" if entry is None else entry["version"])
                repo.write_state(versions, entry)
                result = self.run_child(repo, "check")
                self.assertEqual(result.returncode, 1)
                self.assertIn("integration", result.stderr)

    def test_pin_is_introduced_by_the_first_pull_request(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = baseline(directory)
            repo.track(INTEGRATION_BASE, repo.git("rev-parse", "HEAD"))
            repo.write_state(dict.fromkeys(UNITS, "0.7.0-rc.1"), PIN)
            result = self.run_child(repo, "check", title="feat!: pin the composition release", base_ref=INTEGRATION_BASE)
            self.assertEqual(result.returncode, 0, result.stderr)
            repo.write_state(dict.fromkeys(UNITS, "0.7.1-rc.1"), PIN)
            result = self.run_child(repo, "check", title="feat!: pin the composition release", base_ref=INTEGRATION_BASE)
            self.assertEqual(result.returncode, 1)
            self.assertIn("pin 0.7.0-rc.1", result.stderr)

    def test_entry_for_another_base_cannot_enter_main(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = baseline(directory)
            repo.write_state(dict.fromkeys(UNITS, "0.7.0-rc.1"), PIN)
            result = repo.run("check", "refs/remotes/origin/main", "feat!: pin the composition release")
            self.assertEqual(result.returncode, 1)
            self.assertIn("integration", result.stderr)

    def test_malformed_entry_fails(self):
        for entry in [{"base": INTEGRATION_BASE}, {"base": INTEGRATION_BASE, "version": "seven"},
                      {"base": "", "version": "0.7.0-rc.1"}, "0.7.0-rc.1"]:
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as directory:
                repo = baseline(directory)
                repo.track(INTEGRATION_BASE, repo.git("rev-parse", "HEAD"))
                repo.write_state(dict.fromkeys(UNITS, "0.7.0-rc.1"), entry)
                result = self.run_child(repo, "check", title="feat!: pin the composition release")
                self.assertEqual(result.returncode, 1)
                self.assertIn("integration", result.stderr)

    def final_pull_request(self, directory, main_versions=None):
        """The integration tip, entry removed, against a main that may have moved on."""
        repo = self.integration(directory)
        repo.git("switch", "integration")
        repo.write("packages/core/src.ts", "composition feature")
        repo.commit("feat: add composition")
        if main_versions:
            repo.git("switch", "main")
            repo.write_state(main_versions)
            repo.commit("chore: main moved on")
            repo.track("main", repo.git("rev-parse", "HEAD"))
            repo.git("switch", "integration")
            repo.git("merge", "-s", "ours", "-m", "chore: merge main", "refs/remotes/origin/main")
        repo.write_state(dict.fromkeys(UNITS, "0.7.0-rc.1"))
        return repo

    def test_final_pull_request_into_main_advances_the_baseline_to_the_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = self.final_pull_request(directory)
            result = repo.run("check", "refs/remotes/origin/main", "feat!: release view composition", base_ref="main")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("integration", json.loads((repo.root / ".version-policy.json").read_text()))

    def test_final_pull_request_fails_when_main_has_moved_past_the_pin(self):
        for moved in ["0.7.0-rc.1", "0.8.0-rc.1"]:
            with self.subTest(main=moved), tempfile.TemporaryDirectory() as directory:
                repo = self.final_pull_request(directory, dict.fromkeys(UNITS, moved))
                result = repo.run("check", "refs/remotes/origin/main", "feat!: release view composition", base_ref="main")
                self.assertEqual(result.returncode, 1)
                self.assertIn("expected", result.stderr)

    def test_final_pull_request_cannot_keep_the_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = self.final_pull_request(directory)
            repo.write_state(dict.fromkeys(UNITS, "0.7.0-rc.1"), PIN)
            result = repo.run("check", "refs/remotes/origin/main", "feat!: release view composition", base_ref="main")
            self.assertEqual(result.returncode, 1)
            self.assertIn("integration", result.stderr)

    def test_ordinary_product_pull_request_into_main_must_still_bump(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = baseline(directory)
            repo.write("packages/core/src.ts", "fix")
            result = repo.run("check", "refs/remotes/origin/main", "fix: correct core", base_ref="main")
            self.assertEqual(result.returncode, 1)
            self.assertIn("expected 0.6.5-rc.1", result.stderr)
            self.assertEqual(repo.run("update", "refs/remotes/origin/main", "fix: correct core", base_ref="main").returncode, 0)
            self.assertEqual(repo.run("check", "refs/remotes/origin/main", "fix: correct core", base_ref="main").returncode, 0)
            self.assertEqual(repo.versions()["core"], "0.6.5-rc.1")
            self.assertEqual(repo.versions()["mcp"], "0.6.4-rc.1")

    def test_child_still_needs_the_current_base(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = self.integration(directory)
            repo.git("switch", "integration")
            repo.write("docs/later.md", "later")
            repo.commit("docs: advance integration branch")
            repo.track(INTEGRATION_BASE, repo.git("rev-parse", "HEAD"))
            repo.git("switch", "child")
            repo.write("packages/core/src.ts", "product change")
            result = self.run_child(repo, "check")
            self.assertEqual(result.returncode, 1)
            self.assertIn("behind current base", result.stderr)


class GuidanceTest(unittest.TestCase):
    def test_policy_document_is_the_updaters_guidance(self):
        spec = importlib.util.spec_from_file_location("mw_version", UPDATER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        document = UPDATER.parents[1] / "docs" / "version-policy.md"
        self.assertEqual(document.read_text(), module.GUIDANCE)
        for rule in ["shares one major.minor", "Integration release procedure", '"integration"']:
            self.assertIn(rule, module.GUIDANCE)


if __name__ == "__main__":
    unittest.main()
