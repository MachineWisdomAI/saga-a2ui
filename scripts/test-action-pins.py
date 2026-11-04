"""Exercise the workflow action pin policy against fixtures and this repository."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

CHECKER = Path(__file__).with_name("check-action-pins.py")
SHA = "11d5960a326750d5838078e36cf38b85af677262"
DIGEST = "sha256:" + "a" * 64

spec = importlib.util.spec_from_file_location("check_action_pins", CHECKER)
pins = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pins)


def findings(text):
    return list(pins.scan("workflow.yml", text))


def steps(items):
    """Return a workflow whose single job runs the step YAML in `items`."""
    return "jobs:\n  build:\n    steps:\n" + textwrap.indent(items, "      ")


def job(body):
    """Return a workflow whose single job has the YAML mapping text in `body`."""
    return "jobs:\n  build:\n" + textwrap.indent(body, "    ")


def action(items):
    """Return a composite action that runs the step YAML in `items`."""
    return "runs:\n  using: composite\n  steps:\n" + textwrap.indent(items, "    ")


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
                self.assertEqual(len(findings(steps(f"- uses: {ref}\n"))), 1)
                self.assertEqual(len(findings(job(f"uses: {ref}\n"))), 1)

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
                self.assertEqual(findings(steps(f"- uses: {ref}\n")), [])
                self.assertEqual(findings(job(f"uses: {ref}\n")), [])

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
                self.assertEqual(len(findings(steps(f"- uses: {ref}\n"))), 1)

    def test_recognizes_every_yaml_shape_of_a_uses_key(self):
        for item in [
            "- uses: actions/checkout@v4",
            "- name: x\n  uses: actions/checkout@v4",
            "- uses: 'actions/checkout@v4'",
            '- uses: "actions/checkout@v4"',
            "- uses: actions/checkout@v4 # pinned elsewhere",
            "- 'uses': actions/checkout@v4",
            "- uses:\n    actions/checkout@v4",
            "- uses:\n\n    # note\n    'actions/checkout@v4'",
            "- uses: !!str actions/checkout@v4",
            "- &pin uses: actions/checkout@v4",
            "- uses: &ref actions/checkout@v4",
            "- !!str uses: actions/checkout@v4",
            '- "uses": "actions/checkout@v4"',
            '- "u\\x73es": "actions/checkout@v4"',
            '- "us\\u0065s": "actions/checkout@v4"',
            '- "us\\\n   es": "actions/checkout@v4"',
            '- uses: "actions/checkout@v\\x34"',
        ]:
            with self.subTest(item=item):
                self.assertEqual(len(findings(steps(item + "\n"))), 1)

    def test_rejects_flow_mapping_and_json_shapes(self):
        for text in [
            "jobs:\n  a:\n    steps:\n      - { uses: actions/checkout@v4 }\n",
            "jobs:\n  a:\n    steps: [{ uses: actions/checkout@v4 }]\n",
            "jobs:\n  a:\n    steps: [{uses: actions/checkout@v4, name: x}]\n",
            "jobs: { build: { uses: owner/repo/.github/workflows/build.yml@v2 } }\n",
            "jobs: { build: { 'uses': 'owner/repo/.github/workflows/build.yml@v2' } }\n",
            '{"jobs": {"build": {"steps": [{"uses": "actions/checkout@v4"}]}}}\n',
            '{"jobs":{"b":{"steps":[{"uses":"actions/checkout@v4"}]}}}\n',
            "jobs:\n  a:\n    steps:\n      - {\n          name: x,\n          uses: actions/checkout@v4,\n        }\n",
            "jobs:\n  a:\n    steps: [ uses: actions/checkout@v4 ]\n",
            "jobs: { a: { steps: [ { ? uses : actions/checkout@v4 } ] } }\n",
            # Root-level fragments, as a checker caller may pass them.
            "steps:\n  - { uses: actions/checkout@v4 }\n",
            "steps: [{ uses: actions/checkout@v4 }]\n",
            "- { uses: actions/checkout@v4 }\n",
            "- uses: actions/checkout@v4\n",
        ]:
            with self.subTest(text=text):
                self.assertEqual(len(findings(text)), 1)

    def test_rejects_explicit_key_shapes_including_block_scalar_keys(self):
        for item in [
            "- ? uses\n  : actions/checkout@v4",
            "- ? 'uses'\n  : actions/checkout@v4",
            '- ? "uses"\n  : actions/checkout@v4',
            "- ? |-\n    uses\n  : actions/checkout@v4",
            "- ? |\n    uses\n  : actions/checkout@v4",
            "- ? |+\n    uses\n\n  : actions/checkout@v4",
            "- ? >-\n    uses\n  : actions/checkout@v4",
            "- ? >\n    uses\n  : actions/checkout@v4",
            "- ? |2\n     uses\n  : actions/checkout@v4",
            "- ? !!str |-\n    uses\n  : actions/checkout@v4",
            "- ? &k |-\n    uses\n  : actions/checkout@v4",
            "- name: x\n  ? |-\n    uses\n  : actions/checkout@v4",
            "- ? |-\n    uses\n  : actions/checkout@v4\n  name: x",
        ]:
            with self.subTest(item=item):
                self.assertEqual(len(findings(steps(item + "\n"))), 1)
        # The reviewed reproduction, verbatim, as a fragment and in a workflow.
        repro = "steps:\n  - ? |-\n      uses\n    : actions/checkout@v4\n"
        self.assertEqual(len(findings(repro)), 1)
        self.assertEqual(len(findings("jobs:\n  b:\n" + textwrap.indent(repro, "    "))), 1)
        reusable = job("? |-\n  uses\n: owner/repo/.github/workflows/a.yml@v1\n")
        self.assertEqual(len(findings(reusable)), 1)
        self.assertEqual(len(list(pins.scan("action.yml", action(
            "- ? |-\n    uses\n  : actions/checkout@v4\n")))), 1)

    def test_accepts_every_shape_of_an_immutable_reference(self):
        for text in [
            steps(f"- {{ uses: actions/checkout@{SHA} }}\n"),
            steps(f"- ? |-\n    uses\n  : actions/checkout@{SHA}\n"),
            steps(f"- ? uses\n  : actions/checkout@{SHA}\n"),
            steps(f"- uses:\n    actions/checkout@{SHA}\n"),
            steps(f"- uses: !!str actions/checkout@{SHA} # v4\n"),
            f"jobs:\n  a:\n    steps: [{{uses: 'actions/checkout@{SHA}'}}]\n",
            f'{{"jobs": {{"a": {{"steps": [{{"uses": "actions/checkout@{SHA}"}}]}}}}}}\n',
            "jobs: { b: { uses: ./.github/workflows/x.yml } }\n",
        ]:
            with self.subTest(text=text):
                self.assertEqual(findings(text), [])

    def test_a_uses_key_outside_an_executable_location_is_not_an_action(self):
        # An input or environment variable may be named `uses`; quoting or
        # renaming it must never be needed.
        for text in [
            "with: { uses: harmless }\n",
            "env: { uses: harmless }\n",
            "env:\n  uses: harmless\n",
            "env:\n  'uses': harmless\n",
            "with:\n  ? |-\n    uses\n  : harmless\n",
            steps("- uses: actions/checkout@{0}\n  with: {{ uses: harmless }}\n".format(SHA)),
            steps("- uses: actions/checkout@{0}\n  with:\n    uses: harmless\n".format(SHA)),
            steps("- uses: actions/checkout@{0}\n  with:\n    'uses': v4\n    \"uses\": v4\n".format(SHA)),
            steps("- run: echo\n  env:\n    uses: harmless\n"),
            steps("- run: echo\n  env:\n    ? |-\n      uses\n    : actions/checkout@v4\n"),
            steps("- name: x\n  with:\n    steps:\n      - uses: actions/checkout@v4\n"),
            job("env: { uses: harmless }\nsteps:\n  - run: echo\n"),
            job("with: { uses: actions/checkout@v4 }\nsteps:\n  - run: echo\n"),
            job("strategy:\n  matrix:\n    include:\n      - uses: v4\n    uses: [a, b]\nsteps:\n  - run: echo\n"),
            job("outputs:\n  uses: ${{ steps.x.outputs.uses }}\nsteps:\n  - run: echo\n"),
            "inputs:\n  uses:\n    description: an input named uses\n    default: v4\n",
            "defaults: { run: { uses: x } }\n",
            "name: uses\non: push\n",
        ]:
            with self.subTest(text=text):
                self.assertEqual(findings(text), [])
        self.assertEqual(list(pins.scan("action.yml", (
            "inputs:\n  uses:\n    description: x\n"
            "runs:\n  using: composite\n  steps:\n    - run: echo\n      env:\n        uses: harmless\n"))), [])

    def test_composite_actions_are_checked_where_their_steps_are(self):
        self.assertEqual(len(list(pins.scan("action.yml", action("- uses: actions/cache@v4\n")))), 1)
        self.assertEqual(len(list(pins.scan("action.yml", action("- { uses: actions/cache@v4 }\n")))), 1)
        self.assertEqual(len(list(pins.scan("action.yml", "runs: { steps: [{ uses: ../shared/action }] }\n"))), 1)
        self.assertEqual(list(pins.scan("action.yml", action(f"- uses: actions/cache@{SHA}\n"))), [])

    def test_rejects_references_it_cannot_resolve_statically(self):
        for item in [
            "- uses: *pin",
            "- uses:",
            "- uses: |\n    actions/checkout@v4",
            "- uses: >-\n    actions/checkout@v4",
            "- uses: [actions/checkout@v4]",
            "- uses: { a: b }",
            "- uses:\n    name: actions/checkout@v4",
            "- uses:\n  - actions/checkout@v4",
            "- uses: ''",
            "- *key : actions/checkout@v4",
            '- uses: "unterminated',
            "- uses: \"bad \\q escape\"",
        ]:
            with self.subTest(item=item):
                self.assertGreaterEqual(len(findings(steps(item + "\n"))), 1)
        for text in ["{ uses: [\n", "jobs: { a: { uses: [ }\n"]:
            with self.subTest(text=text):
                self.assertGreaterEqual(len(findings(text)), 1)

    def test_rejects_ambiguous_executable_structure(self):
        # Merge keys, aliases and anchors can build an executable mapping from
        # text defined elsewhere, so the checker cannot see the result.
        for text in [
            steps("- <<: *base\n  name: x\n"),
            steps("- <<: { uses: actions/checkout@v4 }\n"),
            steps("- <<: [*a, *b]\n"),
            steps("- '<<': *base\n"),
            steps("- *step\n"),
            job("<<: *common\nsteps:\n  - run: echo\n"),
            job("steps: *shared\n"),
            job("steps:\n  - run: echo\n  - *tail\n"),
            "jobs:\n  build: *job\n",
            "jobs: *all\n",
            "jobs:\n  <<: *jobs\n",
            "<<: *workflow\n",
            "*jobs-key : {}\n",
            "steps: *shared\n",
            "runs: *runs\n",
            "- *step\n",
            action("- *step\n"),
        ]:
            with self.subTest(text=text):
                self.assertGreaterEqual(len(findings(text)), 1)

    def test_enforcement_does_not_depend_on_key_case(self):
        for text in [
            steps("- Uses: actions/checkout@v4\n"),
            steps("- USES: actions/checkout@v4\n"),
            "Jobs:\n  a:\n    Steps:\n      - uses: actions/checkout@v4\n",
            "JOBS:\n  a:\n    STEPS:\n      - uses: actions/checkout@v4\n",
            "Runs:\n  Steps:\n    - uses: actions/checkout@v4\n",
        ]:
            with self.subTest(text=text):
                self.assertEqual(len(findings(text)), 1)

    def test_checks_every_document_and_every_duplicate_key(self):
        self.assertEqual(len(findings(
            f"jobs: {{ a: {{ steps: [{{ uses: actions/checkout@{SHA} }}] }} }}\n"
            "---\n"
            "jobs: { b: { steps: [{ uses: actions/checkout@v4 }] } }\n")), 1)
        self.assertEqual(len(findings(
            "jobs:\n  a:\n    steps: []\n    steps:\n      - uses: actions/checkout@v4\n")), 1)
        self.assertEqual(len(findings(
            "jobs:\n  a:\n    uses: ./.github/workflows/x.yml\n    uses: owner/repo/a.yml@v1\n")), 1)
        self.assertEqual(len(findings(
            "--- !!map\njobs: { a: { steps: [{ uses: actions/checkout@v4 }] } }\n...\n")), 1)

    def test_block_scalar_text_is_not_scanned_but_following_keys_are(self):
        text = (
            "jobs:\n"
            "  a:\n"
            "    steps:\n"
            "      - run: |\n"                              # 4
            "          echo\n"
            "          uses: actions/checkout@v4\n"
            "\n"
            "          - uses: actions/checkout@v4\n"
            "        name: after\n"
            "      - run: >-\n"                              # 10
            "          uses: actions/checkout@v4\n"
            "        uses: actions/setup-node@v4\n"          # 12
            "      - uses: actions/cache@v4\n"               # 13
        )
        self.assertEqual([(number, ref) for number, ref, _ in findings(text)],
                         [(12, "actions/setup-node@v4"), (13, "actions/cache@v4")])
        dash = "- |\n  uses: actions/checkout@v4\n- uses: actions/setup-node@v4\n"
        self.assertEqual([number for number, _, _ in findings(dash)], [3])
        trailing = steps("- run: |\n    echo\n\n\n- uses: actions/setup-node@v4\n")
        self.assertEqual([ref for _, ref, _ in findings(trailing)], ["actions/setup-node@v4"])

    def test_plain_text_that_mentions_uses_is_not_a_key(self):
        text = (
            "name: uses actions/checkout@v4\n"
            "description: 'this uses: actions/checkout@v4 internally'\n"
            "run: echo uses actions/checkout@v4\n"
            'env: { NOTE: "uses: actions/checkout@v4" }\n'
        )
        self.assertEqual(findings(text), [])
        self.assertEqual(findings(steps("- name: Explain uses: actions/checkout@v4\n  run: echo uses\n")), [])

    def test_comments_and_unrelated_text_are_not_references(self):
        text = steps(
            "# uses: actions/checkout@v4\n"
            "# - uses: actions/checkout@v4\n"
            "- name: Explain uses: actions/checkout@v4\n"
            "  run: echo 'uses: actions/checkout@v4'\n"
            f"- uses: actions/checkout@{SHA} # v4, not @v4\n"
        )
        self.assertEqual(findings(text), [])

    def test_multi_line_plain_and_quoted_values_are_read_whole(self):
        self.assertEqual(len(findings(steps("- uses: actions/checkout@v4\n    continued\n"))), 1)
        self.assertEqual(findings(steps(f"- name: a\n    b\n  uses: actions/checkout@{SHA}\n")), [])
        self.assertEqual(len(findings(steps(f'- uses: "actions/checkout@{SHA}\n    more"\n'))), 1)

    def test_reports_each_violation_with_its_line(self):
        text = steps(f"- uses: actions/checkout@{SHA}\n- uses: actions/setup-node@v4\n")
        self.assertEqual(findings(text), [
            (5, "actions/setup-node@v4",
             "uses mutable revision 'v4' instead of a full 40-character commit SHA"),
        ])

    def test_command_checks_tracked_workflows_and_composite_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.check_call(["git", "init", "-q"], cwd=root)
            files = {
                ".github/workflows/good.yml": steps(f"- uses: actions/checkout@{SHA}\n"),
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
                ".github/workflows/block-key.yml": "jobs:\n  d:\n    steps:\n      - ? |-\n          uses\n        : actions/checkout@v4\n",
                ".github/workflows/with-input.yml": f"jobs:\n  e:\n    steps:\n      - uses: actions/cache@{SHA}\n        with: {{ uses: harmless }}\n",
                ".github/actions/shared/action.yml": "runs:\n  using: composite\n  steps:\n    - { uses: ../shared/action }\n",
                ".github/actions/pinned/action.yml": f"runs:\n  steps:\n    - {{ uses: actions/cache@{SHA} }}\n",
            }
            for name, content in files.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            subprocess.check_call(["git", "add", "--", *files], cwd=root)
            names, problems = pins.check(root)
            self.assertEqual(len(names), 7)
            flagged = sorted(problem.split(":", 1)[0] for problem in problems)
            self.assertEqual(flagged, [
                ".github/actions/shared/action.yml",
                ".github/workflows/block-key.yml",
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
