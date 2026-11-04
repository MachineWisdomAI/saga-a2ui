#!/usr/bin/env python3
"""Reject executable workflow actions that are not pinned to an immutable revision.

Every `uses` entry in `.github/workflows` and `.github/actions` must be a
repository-owned local path (`./...` with no `..` segment), a Docker image with
a `@sha256:` digest, or a repository action pinned to a full 40-character
commit SHA. Branch and tag references, including major-version tags, can move
after review and are rejected.

The files are YAML, so the checker reads them with a small standard-library
tokenizer rather than by matching lines. It recognizes a `uses` key in block,
flow (`{ uses: ... }`, `[{ uses: ... }]`), JSON, explicit (`? uses`) and quoted
(including escaped) forms, ignores comments and block-scalar text such as
`run: |`, and skips anchors and tags before a key or value. It fails closed:
a `uses` whose value is not one literal string (an alias, a block scalar, a
collection or nothing), an alias used as a mapping key, and text it cannot
tokenize are all reported, so no form can pass unchecked. A key named `uses`
that is not an action reference (for example a `with:` input) is reported
too; quote or rename it.
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


class Token(NamedTuple):
    kind: str  # plain, quoted, block, dash, qmark, colon, open, close, comma, prop, alias
    value: str
    line: int
    col: int


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
    """Split YAML into the tokens that decide where a `uses` key and value are."""
    text = text.removeprefix("\ufeff")
    size = len(text)
    starts = [0] + [match.end() for match in re.finditer("\n", text)]
    tokens = []
    depth = 0
    i = 0

    def locate(index):
        line = bisect.bisect_right(starts, index)
        return line, index - starts[line - 1]

    def add(kind, value, index):
        line, col = locate(index)
        tokens.append(Token(kind, value, line, col))

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
            add("alias" if char == "*" else "prop", text[i + 1:end], i)
            i = end
        elif char in "|>":
            if depth:
                raise ValueError(f"line {line}: block scalar inside a flow collection")
            parent = block_parent_column(tokens, line)
            add("block", "", i)
            i = skip_block_scalar(text, i, parent)
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
            add("quoted", value, i)
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
            add("quoted", fold(text[i + 1:end].replace("''", "'")), i)
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
            add("plain", text[i:end].strip(), i)
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


def uses_value(tokens, start):
    """Return (reference, reason) for the value that follows a `uses:` colon."""
    index = start
    while index < len(tokens) and tokens[index].kind == "prop":
        index += 1
    value = tokens[index] if index < len(tokens) else None
    if value is None or value.kind not in ("plain", "quoted"):
        return "", "`uses` has no single literal action reference (alias, block scalar, collection or empty)"
    following = tokens[index + 1] if index + 1 < len(tokens) else None
    if following is not None and following.kind == "colon":
        return "", "`uses` has no literal action reference (it is empty or holds a mapping)"
    return value.value, violation(value.value)


def scan(name, text):
    """Yield (line number, reference, reason) for each unpinned or unverifiable reference."""
    try:
        tokens = tokenize(text)
    except ValueError as error:
        yield 1, "", f"could not be scanned conservatively: {error}"
        return
    for index, token in enumerate(tokens):
        following = tokens[index + 1] if index + 1 < len(tokens) else None
        if following is None or following.kind != "colon":
            continue
        if token.kind == "alias":
            yield token.line, "", "uses an alias as a mapping key, which cannot be checked"
        elif token.kind in ("plain", "quoted") and token.value == "uses":
            ref, reason = uses_value(tokens, index + 2)
            if reason:
                yield token.line, ref, reason


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
