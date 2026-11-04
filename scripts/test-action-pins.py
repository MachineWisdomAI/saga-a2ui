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
            "./.github/workflows/reusable.yml",
        ]:
            with self.subTest(ref=ref):
                self.assertEqual(findings(f"      - uses: {ref}\n"), [])

    def test_only_the_repository_owned_dot_slash_form_is_local(self):
        for ref in [
            "../shared/action",
            "./../shared/action",
            "./a/../../shared/action",
            "./..",
            ".",
            "/abs/path",
            ".github/actions/local",
        ]:
            with self.subTest(ref=ref):
                self.assertEqual(len(findings(f"      - uses: {ref}\n")), 1)

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

    def test_rejects_flow_mapping_and_json_shapes(self):
        for text in [
            "steps:\n  - { uses: actions/checkout@v4 }\n",
            "steps: [{ uses: actions/checkout@v4 }]\n",
            "steps: [{uses: actions/checkout@v4, name: x}]\n",
            "jobs: { build: { uses: owner/repo/.github/workflows/build.yml@v2 } }\n",
            "jobs: { build: { 'uses': 'owner/repo/.github/workflows/build.yml@v2' } }\n",
            '{"jobs": {"build": {"steps": [{"uses": "actions/checkout@v4"}]}}}\n',
            '{"jobs":{"b":{"steps":[{"uses":"actions/checkout@v4"}]}}}\n',
            "steps:\n  - {\n      name: x,\n      uses: actions/checkout@v4,\n    }\n",
            "steps: [ uses: actions/checkout@v4 ]\n",
        ]:
            with self.subTest(text=text):
                self.assertEqual(len(findings(text)), 1)

    def test_rejects_explicit_key_and_split_shapes(self):
        for text in [
            "steps:\n  - ? uses\n    : actions/checkout@v4\n",
            "steps:\n  - ? 'uses'\n    : actions/checkout@v4\n",
            "steps:\n  - uses:\n      actions/checkout@v4\n",
            "steps:\n  - uses:\n\n      # note\n      'actions/checkout@v4'\n",
            "steps:\n  - uses: !!str actions/checkout@v4\n",
            "steps:\n  - &pin uses: actions/checkout@v4\n",
            "steps:\n  - uses: &ref actions/checkout@v4\n",
            "steps:\n  - !!str uses: actions/checkout@v4\n",
            '- "uses": "actions/checkout@v4"\n',
            '- "u\\x73es": "actions/checkout@v4"\n',
            '- "us\\u0065s": "actions/checkout@v4"\n',
            '- "us\\\n   es": "actions/checkout@v4"\n',
            '- uses: "actions/checkout@v\\x34"\n',
            "- uses: 'actions/checkout@v4'\n",
        ]:
            with self.subTest(text=text):
                self.assertEqual(len(findings(text)), 1)

    def test_rejects_references_it_cannot_resolve_statically(self):
        for text in [
            "- uses: *pin\n",
            "- uses:\n",
            "- uses: |\n    actions/checkout@v4\n",
            "- uses: >-\n    actions/checkout@v4\n",
            "- uses: [actions/checkout@v4]\n",
            "- uses: { a: b }\n",
            "- uses:\n    name: actions/checkout@v4\n",
            "- uses:\n  - actions/checkout@v4\n",
            "- uses: ''\n",
            "- *key : actions/checkout@v4\n",
            '- uses: "unterminated\n',
            "- uses: \"bad \\q escape\"\n",
            "{ uses: [\n",
        ]:
            with self.subTest(text=text):
                self.assertGreaterEqual(len(findings(text)), 1)

    def test_accepts_every_shape_of_an_immutable_reference(self):
        for text in [
            f"steps:\n  - {{ uses: actions/checkout@{SHA} }}\n",
            f"steps: [{{uses: 'actions/checkout@{SHA}'}}]\n",
            f'{{"steps": [{{"uses": "actions/checkout@{SHA}"}}]}}\n',
            f"steps:\n  - ? uses\n    : actions/checkout@{SHA}\n",
            f"steps:\n  - uses:\n      actions/checkout@{SHA}\n",
            f"jobs: {{ b: {{ uses: ./.github/workflows/x.yml }} }}\n",
            f"- uses: !!str actions/checkout@{SHA} # v4\n",
        ]:
            with self.subTest(text=text):
                self.assertEqual(findings(text), [])

    def test_block_scalar_text_is_not_scanned_but_following_keys_are(self):
        text = (
            "steps:\n"
            "  - run: |\n"
            "      echo\n"
            "      uses: actions/checkout@v4\n"
            "\n"
            "      - uses: actions/checkout@v4\n"
            "    name: after\n"
            "  - run: >-\n"
            "      uses: actions/checkout@v4\n"
            "    uses: actions/setup-node@v4\n"
            "  - uses: actions/cache@v4\n"
        )
        self.assertEqual([(number, ref) for number, ref, _ in findings(text)],
                         [(10, "actions/setup-node@v4"), (11, "actions/cache@v4")])
        top = "run: |\n  uses: actions/checkout@v4\nuses: actions/setup-node@v4\n"
        self.assertEqual([number for number, _, _ in findings(top)], [3])
        dash = "- |\n  uses: actions/checkout@v4\n- uses: actions/setup-node@v4\n"
        self.assertEqual([number for number, _, _ in findings(dash)], [3])

    def test_plain_text_that_mentions_uses_is_not_a_key(self):
        text = (
            "name: uses actions/checkout@v4\n"
            "description: 'this uses: actions/checkout@v4 internally'\n"
            "run: echo uses actions/checkout@v4\n"
            'env: { NOTE: "uses: actions/checkout@v4" }\n'
        )
        self.assertEqual(findings(text), [])

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

    def test_command_rejects_flow_reusable_workflow_and_composite_forms(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.check_call(["git", "init", "-q"], cwd=root)
            files = {
                ".github/workflows/flow.yml": "jobs:\n  a:\n    steps: [{ uses: actions/checkout@v4 }]\n",
                ".github/workflows/reusable.yaml": "jobs: { b: { uses: owner/repo/.github/workflows/b.yml@v2 } }\n",
                ".github/workflows/explicit.yml": "jobs:\n  c:\n    steps:\n      - ? uses\n        : actions/setup-node@v4\n",
                ".github/actions/shared/action.yml": "runs:\n  using: composite\n  steps:\n    - { uses: ../shared/action }\n",
                ".github/actions/pinned/action.yml": f"runs:\n  steps:\n    - {{ uses: actions/cache@{SHA} }}\n",
            }
            for name, content in files.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            subprocess.check_call(["git", "add", "--", *files], cwd=root)
            names, problems = pins.check(root)
            self.assertEqual(len(names), 5)
            flagged = sorted(problem.split(":", 1)[0] for problem in problems)
            self.assertEqual(flagged, [
                ".github/actions/shared/action.yml",
                ".github/workflows/explicit.yml",
                ".github/workflows/flow.yml",
                ".github/workflows/reusable.yaml",
            ])

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
