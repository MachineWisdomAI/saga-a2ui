"""Exercise the workflow action pin policy against fixtures and this repository."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CHECKER = Path(__file__).with_name("check-action-pins.py")
SHA = "11d5960a326750d5838078e36cf38b85af677262"
DIGEST = "sha256:" + "a" * 64

spec = importlib.util.spec_from_file_location("check_action_pins", CHECKER)
pins = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pins)


def findings(text):
    return list(pins.scan("workflow.yml", text))


class ActionPinTests(unittest.TestCase):
    def test_rejects_mutable_references(self):
        for ref in [
            "actions/checkout@v4",
            "actions/checkout@v4.4.0",
            "actions/checkout@main",
            "actions/checkout@" + SHA[:7],
            "actions/checkout@" + SHA.upper(),
            "actions/checkout@" + SHA + "0",
            "actions/checkout",
            "owner/repo/path/to/action@v1",
            "owner/repo/.github/workflows/build.yml@v2",
            "docker://alpine:3.20",
            "docker://alpine@sha256:abc",
        ]:
            with self.subTest(ref=ref):
                self.assertEqual(len(findings(f"      - uses: {ref}\n")), 1)

    def test_accepts_immutable_and_local_references(self):
        for ref in [
            f"actions/checkout@{SHA} # v4",
            f"owner/repo/path/to/action@{SHA}",
            f"owner/repo/.github/workflows/build.yml@{SHA}",
            f"docker://alpine@{DIGEST}",
            "./.github/actions/local",
            "../shared/action",
        ]:
            with self.subTest(ref=ref):
                self.assertEqual(findings(f"      - uses: {ref}\n"), [])

    def test_recognizes_every_yaml_shape_of_a_uses_key(self):
        for line in [
            "      - uses: actions/checkout@v4",
            "        uses: actions/checkout@v4",
            "    uses: owner/repo/.github/workflows/a.yml@v1",
            "      - uses: 'actions/checkout@v4'",
            '      - uses: "actions/checkout@v4"',
            "      - uses: actions/checkout@v4 # pinned elsewhere",
            "      - 'uses': actions/checkout@v4",
            "- uses: actions/checkout@v4",
        ]:
            with self.subTest(line=line):
                self.assertEqual(len(findings(line + "\n")), 1)

    def test_comments_and_unrelated_text_are_not_references(self):
        text = (
            "# uses: actions/checkout@v4\n"
            "      # - uses: actions/checkout@v4\n"
            "      - name: Explain uses: actions/checkout@v4\n"
            "        run: echo 'uses: actions/checkout@v4'\n"
            f"      - uses: actions/checkout@{SHA} # v4, not @v4\n"
        )
        self.assertEqual(findings(text), [])

    def test_reports_each_violation_with_its_line(self):
        text = f"steps:\n  - uses: actions/checkout@{SHA}\n  - uses: actions/setup-node@v4\n"
        self.assertEqual(findings(text), [
            (3, "actions/setup-node@v4",
             "uses mutable revision 'v4' instead of a full 40-character commit SHA"),
        ])

    def test_command_checks_tracked_workflows_and_composite_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.check_call(["git", "init", "-q"], cwd=root)
            files = {
                ".github/workflows/good.yml": f"steps:\n  - uses: actions/checkout@{SHA}\n",
                ".github/actions/local/action.yaml": "runs:\n  steps:\n    - uses: actions/cache@v4\n",
                ".github/README.md": "uses: actions/checkout@v4\n",
                "docs/example.yml": "uses: actions/checkout@v4\n",
            }
            for name, content in files.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            subprocess.check_call(["git", "add", "--", *files], cwd=root)
            names, problems = pins.check(root)
            self.assertEqual(names, [".github/actions/local/action.yaml", ".github/workflows/good.yml"])
            self.assertEqual(len(problems), 1)
            self.assertIn(".github/actions/local/action.yaml:3: 'actions/cache@v4'", problems[0])

    def test_this_repository_pins_every_executable_action(self):
        result = subprocess.run([sys.executable, str(CHECKER)], capture_output=True, text=True,
                                cwd=CHECKER.parent)
        self.assertEqual(result.returncode, 0, result.stderr)
        root = CHECKER.parent.parent
        names, problems = pins.check(root)
        self.assertEqual(problems, [])
        # The control must be exercising real workflows, not an empty set.
        self.assertIn(".github/workflows/ci.yml", names)
        self.assertIn(".github/workflows/lint.yml", names)
        self.assertIn(".github/workflows/version-policy.yml", names)


if __name__ == "__main__":
    unittest.main()
