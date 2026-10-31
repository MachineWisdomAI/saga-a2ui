"""Exercise CI routing through the command and real Git changes, without Node."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("ci-scope.py")


class CiScopeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "repository"
        self.root.mkdir()
        self.git("init", "-q")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "user.name", "CI fixture")
        self.write("README.md", "before")
        self.write("docs/banner.png", "before")
        self.write("apps/player/icon.png", "before")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    def write(self, name, content):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self):
        # Explicit fixture paths, never the developer's checkout.
        names = self.git("ls-files", "--others", "--exclude-standard").splitlines()
        tracked = self.git("ls-files").splitlines()
        self.git("add", "--", *sorted(set(names + tracked)))
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def route(self, event="pull_request", base=None, head=None):
        output = Path(self.directory.name) / "github-output"
        env = {**os.environ, "GITHUB_OUTPUT": str(output)}
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--event", event,
             "--base", base or self.base, "--head", head or self.git("rev-parse", "HEAD")],
            cwd=self.root, env=env, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        values = dict(line.split("=", 1) for line in output.read_text().splitlines())
        self.assertEqual(values["application"], "true" if values["scope"] == "full" else "false")
        return values["scope"]

    def test_root_nested_markdown_and_documentation_artwork_skip_application(self):
        for name in ["README.md", "docs/setup.MD", "docs/nested/guide.md",
                     "docs/getting-started.md", "docs/attach-to-existing-backend.md",
                     "docs/actions.md", "docs/candidate-update-and-rollback.md", "THIRD_PARTY_NOTICES.md",
                     "blueprints/features/card.md", "packages/core/README.md",
                     "assets/brand/logo.SVG", "docs/nested/banner.PNG", "diagrams/flow.svg"]:
            self.write(name, "updated")
        self.commit()
        self.assertEqual(self.route(), "docs")

    def test_runtime_assets_and_unknown_or_executable_paths_keep_full_coverage(self):
        for name in ["apps/player/icon.png", "packages/core/src/prompt.md", "demo/fixtures/input.md",
                     "docs/check.py", "docs/evidence/receipt.md", "docs/artifacts/bundle.svg",
                     "docs/model.json", "new-format.xyz", "package-lock.json", ".gitattributes",
                     "assets/brand/plugin/logo-dark.png", "assets/brand/plugin/composer-icon-light.png",
                     ".github/workflows/ci.yml", "scripts/ci-scope.py"]:
            with self.subTest(name=name):
                self.write(name, "updated")
                head = self.commit()
                self.assertEqual(self.route(), "full")
                self.base = head

    def test_mixed_documentation_and_application_changes_keep_full_coverage(self):
        self.write("README.md", "updated")
        self.write("packages/core/src/index.ts", "updated")
        self.commit()
        self.assertEqual(self.route(), "full")

    def test_policy_only_and_policy_plus_docs_use_focused_checks(self):
        for name in ["scripts/mw-version.py", "scripts/test-version-enrollment.py",
                     "scripts/check-version-enrollment.py", ".version-policy.json",
                     ".github/workflows/version-policy.yml", "README.md"]:
            self.write(name, "updated")
        self.commit()
        self.assertEqual(self.route(), "policy")
        self.assertEqual(self.route(event="push"), "policy")

    def test_deletions_and_renames_check_both_old_and_new_paths(self):
        self.git("mv", "apps/player/icon.png", "docs/runtime-moved.png")
        self.commit()
        self.assertEqual(self.route(), "full")
        self.base = self.git("rev-parse", "HEAD")
        self.git("rm", "README.md")
        self.git("mv", "docs/banner.png", "docs/new banner.png")
        self.commit()
        self.assertEqual(self.route(), "docs")
        self.base = self.git("rev-parse", "HEAD")
        self.git("mv", "docs/new banner.png", "apps/player/new.png")
        self.commit()
        self.assertEqual(self.route(), "full")

    def test_manual_unknown_event_and_missing_history_always_run_everything(self):
        self.write("README.md", "updated")
        self.commit()
        for event in ["workflow_dispatch", "unknown"]:
            self.assertEqual(self.route(event=event), "full")
        self.assertEqual(self.route(base="0" * 40), "full")
        self.assertEqual(self.route(base="missing"), "full")

    def test_empty_diff_is_conservative(self):
        self.assertEqual(self.route(), "full")

    def test_pull_request_uses_merge_base_but_push_checks_all_changed_paths(self):
        self.git("checkout", "-qb", "topic")
        self.write("README.md", "topic documentation")
        head = self.commit()
        self.git("checkout", "-qb", "upstream", self.base)
        self.write("packages/core/src/index.ts", "upstream code")
        base = self.commit()
        self.assertEqual(self.route(base=base, head=head), "docs")
        self.assertEqual(self.route(event="push", base=base, head=head), "full")


if __name__ == "__main__":
    unittest.main()
