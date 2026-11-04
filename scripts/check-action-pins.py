#!/usr/bin/env python3
"""Reject executable workflow actions that are not pinned to an immutable revision.

Every `uses` entry of a step, job (reusable workflow) or composite action in
`.github/workflows` and `.github/actions` must be a repository-owned local path
(`./...` with no `..` segment), a Docker image with a `@sha256:` digest, or a
repository action pinned to a full 40-character commit SHA. Branch and tag
references, including major-version tags, can move after review and are
rejected.

The files are YAML, so the checker parses them with a small standard-library
reader rather than by matching lines. It reads block, flow (`{ uses: ... }`),
JSON, explicit-key (`? uses`, including a block-scalar key) and quoted
(including escaped) forms, ignores comments and block-scalar text such as
`run: |`, and skips anchors and tags. It checks every document of a file and
every duplicate key, and it compares keys without regard to case.

Only executable locations are enforced: a `uses` key that is a direct child of
a step, of a job, or of the mapping at the root of a document or under `runs`
(the same walk covers a bare fragment). A key named `uses` anywhere else, such
as a `with:` input or an `env:` variable, is data and is not reported, so it
never needs quoting or renaming.

It fails closed wherever the executable structure cannot be read statically:
a `uses` whose value is not one literal string (an alias, a block scalar, a
collection or nothing); an alias or a merge key (`<<`) where a step, job,
`steps`, `jobs` or `runs` node or key is expected; and text it cannot parse.
"""
import argparse
import bisect
from pathlib import Path
import re
import subprocess
import sys
from typing import NamedTuple

FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
DOCKER_DIGEST = re.compile(r"^docker://[^@\s]+@sha256:[0-9a-f]{64}$")
SCOPES = (".github/workflows/", ".github/actions/")
SUFFIXES = (".yml", ".yaml")
BLANKS = " \t\r\n"
FLOW_INDICATORS = ",[]{}"
SIMPLE_ESCAPES = {
    "0": "\0", "a": "\a", "b": "\b", "t": "\t", "\t": "\t", "n": "\n", "v": "\v",
    "f": "\f", "r": "\r", "e": "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\",
    "N": "\x85", "_": "\xa0", "L": "\u2028", "P": "\u2029",
}
HEX_ESCAPES = {"x": 2, "u": 4, "U": 8}
NOT_LITERAL = "`uses` has no single literal action reference (alias, block scalar, collection or empty)"


class Token(NamedTuple):
    kind: str  # plain, quoted, block, dash, qmark, colon, open, close, comma, prop, alias, doc
    value: str
    line: int
    col: int
    end: int  # last line the token occupies


class Scalar(NamedTuple):
    kind: str  # plain, quoted, block or null
    value: str
    line: int


class Alias(NamedTuple):
    line: int


class Mapping(NamedTuple):
    pairs: list
    line: int


class Sequence(NamedTuple):
    items: list
    line: int


def decode_double_quoted(raw):
    """Return a double-quoted scalar's value, resolving escapes and line folding."""
    out = []
    i = 0
    while i < len(raw):
        char = raw[i]
        if char != "\\":
            out.append(char)
            i += 1
            continue
        i += 1
        if i >= len(raw):
            raise ValueError("dangling escape")
        escape = raw[i]
        if escape == "\n":
            i += 1
            while i < len(raw) and raw[i] in " \t":
                i += 1
        elif escape in HEX_ESCAPES:
            width = HEX_ESCAPES[escape]
            digits = raw[i + 1:i + 1 + width]
            if len(digits) != width or not re.fullmatch(r"[0-9a-fA-F]+", digits):
                raise ValueError(f"invalid \\{escape} escape")
            try:
                out.append(chr(int(digits, 16)))
            except ValueError:
                raise ValueError(f"invalid \\{escape} escape") from None
            i += 1 + width
        elif escape in SIMPLE_ESCAPES:
            out.append(SIMPLE_ESCAPES[escape])
            i += 1
        else:
            raise ValueError(f"unknown escape \\{escape}")
    return fold("".join(out))


def fold(value):
    """Fold the line breaks of a flow scalar into spaces."""
    if "\n" not in value:
        return value
    return re.sub(r"[ \t]*\n[ \t]*", " ", value)


def tokenize(text):
    """Split YAML into the tokens that decide where each key and value is."""
    text = text.removeprefix("\ufeff")
    size = len(text)
    starts = [0] + [match.end() for match in re.finditer("\n", text)]
    tokens = []
    depth = 0
    i = 0

    def locate(index):
        line = bisect.bisect_right(starts, index)
        return line, index - starts[line - 1]

    def add(kind, value, index, stop=None):
        line, col = locate(index)
        end = locate(max(index, (index + 1 if stop is None else stop) - 1))[0]
        tokens.append(Token(kind, value, line, col, end))

    while i < size:
        char = text[i]
        if char in BLANKS:
            i += 1
            continue
        line, col = locate(i)
        following = text[i + 1] if i + 1 < size else "\n"
        before = text[i - 1] if i else "\n"
        if char == "#":
            if before not in BLANKS:
                raise ValueError(f"line {line}: unexpected '#'")
            end = text.find("\n", i)
            i = size if end < 0 else end
            continue
        if col == 0 and text.startswith(("---", "..."), i) and (i + 3 >= size or text[i + 3] in BLANKS):
            add("doc", text[i:i + 3], i, i + 3)
            i += 3
            continue
        previous = tokens[-1] if tokens else None
        if char == "-" and following in BLANKS:
            add("dash", "-", i)
            i += 1
        elif char == "?" and following in BLANKS:
            add("qmark", "?", i)
            i += 1
        elif char == ":" and (
            following in BLANKS
            or (depth and following in FLOW_INDICATORS)
            or (previous and (previous.kind == "quoted" or previous.kind == "close"))
        ):
            add("colon", ":", i)
            i += 1
        elif char in "[{":
            depth += 1
            add("open", char, i)
            i += 1
        elif char in "]}":
            depth = max(0, depth - 1)
            add("close", char, i)
            i += 1
        elif char == ",":
            add("comma", ",", i)
            i += 1
        elif char in "&!*":
            end = i + 1
            while end < size and text[end] not in BLANKS and not (depth and text[end] in FLOW_INDICATORS):
                end += 1
            add("alias" if char == "*" else "prop", text[i + 1:end], i, end)
            i = end
        elif char in "|>":
            if depth:
                raise ValueError(f"line {line}: block scalar inside a flow collection")
            parent = block_parent_column(tokens, line)
            header_end = text.find("\n", i)
            stop = skip_block_scalar(text, i, parent)
            body = "" if header_end < 0 else text[header_end + 1:stop]
            value = "\n".join(part.strip() for part in body.split("\n")).strip()
            add("block", value, i, stop)
            i = stop
        elif char == '"':
            end = i + 1
            while end < size and text[end] != '"':
                end += 2 if text[end] == "\\" else 1
            if end >= size:
                raise ValueError(f"line {line}: unterminated double-quoted scalar")
            try:
                value = decode_double_quoted(text[i + 1:end])
            except ValueError as error:
                raise ValueError(f"line {line}: {error}") from None
            add("quoted", value, i, end + 1)
            i = end + 1
        elif char == "'":
            end = i + 1
            while True:
                end = text.find("'", end)
                if end < 0:
                    raise ValueError(f"line {line}: unterminated single-quoted scalar")
                if text[end + 1:end + 2] == "'":
                    end += 2
                    continue
                break
            add("quoted", fold(text[i + 1:end].replace("''", "'")), i, end + 1)
            i = end + 1
        else:
            end = i
            while end < size:
                current = text[end]
                after = text[end + 1] if end + 1 < size else "\n"
                if current == "\n":
                    break
                if current == "#" and end > i and text[end - 1] in BLANKS:
                    break
                if current == ":" and (after in BLANKS or (depth and after in FLOW_INDICATORS)):
                    break
                if depth and current in FLOW_INDICATORS:
                    break
                end += 1
            add("plain", text[i:end].strip(), i, i + 1)
            i = max(end, i + 1)
    return tokens


def block_parent_column(tokens, line):
    """Return the column that a block scalar's text must be indented beyond."""
    for index in range(len(tokens) - 1, -1, -1):
        token = tokens[index]
        if token.line != line:
            break
        if token.kind in ("dash", "qmark"):
            return token.col
        if token.kind == "colon":
            key = tokens[index - 1] if index else None
            return key.col if key is not None and key.line == line else 0
    return -1


def skip_block_scalar(text, index, parent):
    """Return the index of the first line after a block scalar that starts at `index`."""
    size = len(text)
    end = text.find("\n", index)
    position = size if end < 0 else end + 1
    while position < size:
        end = text.find("\n", position)
        end = size if end < 0 else end
        content = text[position:end]
        if content.strip():
            indent = len(content) - len(content.lstrip(" "))
            marker = content[:3] in ("---", "...") and content[3:4] in ("", " ", "\t", "\r")
            if indent <= parent or marker:
                break
        position = end + 1
    return min(position, size)


class Parser:
    """Build a node tree from the tokens of one YAML document.

    Only the structure needed to place a `uses` key is kept: mappings (as lists
    of key and value pairs, so duplicate keys survive), sequences, scalars and
    aliases. Properties (anchors and tags) are skipped.
    """

    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self):
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def skip_props(self):
        last = None
        while self.peek() is not None and self.peek().kind == "prop":
            last = self.take()
        return last

    def parse_document(self):
        token = self.peek()
        if token is None:
            return Scalar("null", "", 1)
        node = self.parse_node(-1)
        rest = self.peek()
        if rest is not None:
            raise ValueError(f"line {rest.line}: unexpected content")
        return node

    def parse_node(self, parent):
        """Parse a block node whose enclosing block starts at column `parent`."""
        first = self.peek()
        first_col = first.col
        last_prop = self.skip_props()
        token = self.peek()
        if token is None:
            return Scalar("null", "", first.line)
        if last_prop is not None and token.line != last_prop.line:
            first_col = token.col
        if token.kind == "dash":
            return self.parse_sequence(token.col)
        if token.kind in ("qmark", "colon"):
            return self.parse_mapping(first_col, None)
        node, end = self.parse_inline()
        colon = self.peek()
        if colon is not None and colon.kind == "colon" and colon.line == end:
            return self.parse_mapping(first_col, node)
        if isinstance(node, Scalar) and node.kind == "plain":
            node = self.continue_plain(node, end, parent)
        return node

    def continue_plain(self, node, end, parent):
        """Join the later lines of a multi-line plain scalar into one value."""
        parts = [node.value]
        while True:
            token = self.peek()
            if token is None or token.kind != "plain" or token.line <= end or token.col <= parent:
                break
            self.take()
            after = self.peek()
            if after is not None and after.kind == "colon" and after.line == token.line:
                raise ValueError(f"line {token.line}: mapping values are not allowed here")
            parts.append(token.value)
            end = token.end
        return Scalar("plain", " ".join(parts), node.line)

    def parse_inline(self):
        """Parse a scalar, alias or flow collection; return (node, last line)."""
        token = self.peek()
        if token.kind in ("plain", "quoted", "block"):
            self.take()
            return Scalar(token.kind, token.value, token.line), token.end
        if token.kind == "alias":
            self.take()
            return Alias(token.line), token.end
        if token.kind == "open":
            return self.parse_flow()
        raise ValueError(f"line {token.line}: unexpected '{token.value}'")

    def parse_sequence(self, col):
        items = []
        line = self.peek().line
        while True:
            token = self.peek()
            if token is None or token.kind != "dash" or token.col != col:
                break
            dash = self.take()
            after = self.peek()
            if after is not None and (after.line == dash.line or after.col > col):
                items.append(self.parse_node(col))
            else:
                items.append(Scalar("null", "", dash.line))
        return Sequence(items, line)

    def map_value(self, col, colon):
        """Parse the value that follows a block mapping's `:` at the mapping column `col`."""
        after = self.peek()
        if after is None:
            return Scalar("null", "", colon.line)
        if after.line == colon.line or after.col > col:
            return self.parse_node(col)
        if after.col == col and after.kind == "dash":
            return self.parse_sequence(col)
        return Scalar("null", "", colon.line)

    def parse_mapping(self, col, first_key):
        pairs = []
        pending = first_key
        line = pending.line if pending is not None else self.peek().line
        while True:
            if pending is not None:
                colon = self.take()
                pairs.append((pending, self.map_value(col, colon)))
                pending = None
            else:
                self.skip_props()
                token = self.peek()
                if token is None:
                    break
                if token.kind == "qmark":
                    mark = self.take()
                    after = self.peek()
                    if after is not None and (after.line == mark.line or after.col > col):
                        key = self.parse_node(col)
                    else:
                        key = Scalar("null", "", mark.line)
                    colon = self.peek()
                    if colon is not None and colon.kind == "colon" and colon.col == col:
                        self.take()
                        pairs.append((key, self.map_value(col, colon)))
                    else:
                        pairs.append((key, Scalar("null", "", mark.line)))
                elif token.kind == "colon":
                    self.take()
                    pairs.append((Scalar("null", "", token.line), self.map_value(col, token)))
                else:
                    key, end = self.parse_inline()
                    colon = self.peek()
                    if colon is None or colon.kind != "colon" or colon.line != end:
                        raise ValueError(f"line {token.line}: expected ':' after a mapping key")
                    self.take()
                    pairs.append((key, self.map_value(col, colon)))
            after = self.peek()
            if after is None or after.col < col:
                break
            if after.col > col or after.kind == "dash":
                raise ValueError(f"line {after.line}: unexpected indentation")
        return Mapping(pairs, line)

    def parse_flow(self):
        opener = self.take()
        sequence = opener.value == "["
        closer = "]" if sequence else "}"
        entries = []
        while True:
            token = self.peek()
            if token is None:
                raise ValueError(f"line {opener.line}: unterminated flow collection")
            if token.kind == "close":
                break
            if token.kind == "comma":
                self.take()
                continue
            key, value, paired = self.parse_flow_pair()
            if sequence:
                entries.append(Mapping([(key, value)], key_line(key, token.line)) if paired else key)
            else:
                entries.append((key, value))
            after = self.peek()
            if after is None:
                raise ValueError(f"line {opener.line}: unterminated flow collection")
            if after.kind == "comma":
                self.take()
            elif after.kind != "close":
                raise ValueError(f"line {after.line}: expected ',' or a closing bracket")
        close = self.take()
        if close.value != closer:
            raise ValueError(f"line {close.line}: mismatched flow collection brackets")
        node = Sequence(entries, opener.line) if sequence else Mapping(entries, opener.line)
        return node, close.end

    def parse_flow_pair(self):
        marker = self.peek()
        explicit = marker is not None and marker.kind == "qmark"
        if explicit:
            self.take()
        key = self.parse_flow_node()
        colon = self.peek()
        if colon is not None and colon.kind == "colon":
            self.take()
            return key, self.parse_flow_node(), True
        return key, Scalar("null", "", key_line(key, 1)), explicit

    def parse_flow_node(self):
        self.skip_props()
        token = self.peek()
        if token is None:
            raise ValueError("unterminated flow collection")
        if token.kind in ("comma", "close", "colon"):
            return Scalar("null", "", token.line)
        if token.kind == "open":
            return self.parse_flow()[0]
        if token.kind in ("plain", "quoted", "alias"):
            node, end = self.parse_inline()
            if isinstance(node, Scalar) and node.kind == "plain":
                node = self.continue_plain(node, end, -1)
            return node
        raise ValueError(f"line {token.line}: unexpected '{token.value}'")


def key_line(node, default):
    return getattr(node, "line", default)


def parse_documents(text):
    """Return the root node of each YAML document in `text`."""
    documents = [[]]
    for token in tokenize(text):
        if token.kind == "doc":
            documents.append([])
        else:
            documents[-1].append(token)
    return [Parser(tokens).parse_document() for tokens in documents]


def violation(ref):
    """Return why `ref` is not immutable, or None when it is acceptable."""
    if not ref:
        return "has no action reference"
    if ref.startswith("./"):
        if ".." in ref.split("/"):
            return "is a local path that leaves the repository-owned './' form"
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


def key_name(node):
    """Return a mapping key's comparable name, or None when it is not a string scalar."""
    if isinstance(node, Scalar) and node.kind in ("plain", "quoted", "block"):
        return node.value.strip().casefold()
    return None


def check_reference(value, line, report):
    if isinstance(value, Scalar) and value.kind in ("plain", "quoted") and value.value:
        reason = violation(value.value)
        if reason:
            report(line, value.value, reason)
    else:
        report(line, "", NOT_LITERAL)


def check_executable(node, report):
    """Check a node that holds steps, jobs or an action's `runs`: a step, job or fragment."""
    if isinstance(node, Alias):
        report(node.line, "", "is an alias where steps or jobs are expected, which cannot be checked")
    elif isinstance(node, Sequence):
        for item in node.items:
            check_executable(item, report)
    elif isinstance(node, Mapping):
        check_mapping(node, report)


def check_mapping(node, report):
    """Check the keys of a mapping at the root of a document or inside a step, job or `runs`."""
    for key, value in node.pairs:
        line = key_line(key, node.line)
        if isinstance(key, Alias):
            report(line, "", "uses an alias as a mapping key, which cannot be checked")
            continue
        name = key_name(key)
        if name == "<<":
            report(line, "", "uses a YAML merge key, which cannot be checked")
        elif name == "uses":
            check_reference(value, line, report)
        elif name in ("steps", "runs"):
            check_executable(value, report)
        elif name == "jobs":
            check_jobs(value, report)


def check_jobs(node, report):
    """Check a `jobs` mapping, whose keys are job ids and not action keys."""
    if isinstance(node, Alias):
        report(node.line, "", "is an alias where jobs are expected, which cannot be checked")
    elif isinstance(node, Mapping):
        for key, value in node.pairs:
            if key_name(key) == "<<":
                report(key_line(key, node.line), "", "uses a YAML merge key, which cannot be checked")
            check_executable(value, report)
    elif isinstance(node, Sequence):
        check_executable(node, report)


def scan(name, text):
    """Yield (line number, reference, reason) for each unpinned or unverifiable reference."""
    try:
        documents = parse_documents(text)
    except ValueError as error:
        yield 1, "", f"could not be scanned conservatively: {error}"
        return
    results = []

    def report(line, ref, reason):
        results.append((line, ref, reason))

    for document in documents:
        check_executable(document, report)
    yield from sorted(results, key=lambda item: item[0])


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
            subject = f"'{ref}' " if ref else ""
            problems.append(f"{name}:{number}: {subject}{reason}")
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
