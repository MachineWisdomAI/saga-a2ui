"""Exercise the advisory check with real Git changes and reader-visible text."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("check-blueprint-length.py")


class BlueprintLengthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "-q")
        self.git("config", "user.email", "docs@example.invalid")
        self.git("config", "user.name", "Documentation fixture")
        self.write("blueprints/features/changed.blueprint.md", "before")
        self.write("blueprints/modules/unchanged.blueprint.md", "word " * 1500)
        self.git("add", "blueprints")
        self.git("commit", "-qm", "fixture")
        self.base = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def check(self, base=None):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--base", base or self.base],
            cwd=self.root, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_threshold_is_advisory_and_unchanged_documents_are_quiet(self):
        self.write("blueprints/features/changed.blueprint.md", "word " * 1000)
        self.assertEqual(self.check(), "")
        self.write("blueprints/features/changed.blueprint.md", "word " * 1001)
        output = self.check()
        self.assertIn("1001 words", output)
        self.assertIn("blueprints/features/changed.blueprint.md", output)
        self.assertNotIn("unchanged", output)

    def test_counts_examples_but_excludes_authoring_metadata_and_comments(self):
        self.write("blueprints/features/changed.blueprint.md",
                   "---\nmetadata: " + "word " * 1500 + "\n---\n"
                   + "<!-- " + "word " * 1500 + " -->\n" + "word " * 995
                   + "\n```ts\nconst outcome = 'opened';\n```\n")
        self.assertIn("1001 words", self.check())

    def test_new_modules_are_checked_but_templates_and_deleted_files_are_ignored(self):
        self.git("rm", "blueprints/features/changed.blueprint.md")
        self.write("blueprints/modules/new module.blueprint.md", "word " * 1001)
        self.write("blueprints/templates/feature.blueprint.md", "word " * 1500)
        self.git("add", "blueprints/modules/new module.blueprint.md",
                 "blueprints/templates/feature.blueprint.md")
        output = self.check()
        self.assertIn("new module.blueprint.md", output)
        self.assertNotIn("templates", output)
        self.assertNotIn("changed.blueprint.md", output)

    def test_missing_history_reports_an_unavailable_check_without_blocking(self):
        self.assertIn("unavailable", self.check(base="missing-revision"))


if __name__ == "__main__":
    unittest.main()
