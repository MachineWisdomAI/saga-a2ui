// The one terminal-safe rendering boundary of the maintainer tooling (SECURITY.md invariant 6).
//
// Repository file names, endpoint metadata, analyzer output and release-input strings are chosen by
// someone other than the person reading the output, and a terminal or CI log viewer acts on
// control characters: an escape sequence can retitle the window, move the cursor to overwrite the
// verdict above it or change what a line looks like, and a line that begins with `::` is a
// workflow command in GitHub Actions. Secret redaction runs first (it needs the original text to
// find a credential); this runs last, on everything that is about to be written to a terminal.
//
// Each character is replaced on its own, so the result does not depend on how output is split into
// chunks, and running it again changes nothing (its output holds only printable characters).
// Ordinary text, including non-ASCII letters, is untouched. This file has no dependency so that
// the standalone `.mjs` tools can load it; `terminal-text.d.mts` gives the TypeScript tools its
// types.
//
// Reassess a use when the output it protects stops being rendered by a terminal or CI log viewer.

// C0 controls other than tab and line feed, DEL, the C1 controls (U+009B is a one-character
// control sequence introducer), the bidirectional overrides and isolates that reorder what is
// shown, and the Unicode line and paragraph separators that start a new displayed line.
// eslint-disable-next-line no-control-regex
const CONTROLS =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

const encode = (character) => {
  const code = character.codePointAt(0);
  return code <= 0xff
    ? `\\x${code.toString(16).padStart(2, '0')}`
    : `\\u${code.toString(16).padStart(4, '0')}`;
};

/**
 * Text, possibly several lines, that is safe to write to a terminal: every control character is
 * written out as a visible escape (`\x1b`, `\u202e`), except the line feed that ends a line and
 * the tab. A carriage return would overwrite a line already shown, so `\r\n` becomes `\n` and any
 * other `\r` is written out. A line starting with `::` (a GitHub Actions workflow command) is
 * written with `\x3a:` instead.
 */
export function terminalText(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(CONTROLS, encode)
    .replace(/^([ \t]*)::/gm, '$1\\x3a:');
}

/**
 * One value, such as a file name, a server name or a tool name, as part of a line: like
 * `terminalText`, and the line feed and the tab are written out too, so the value cannot start a
 * line of its own or look like a column break.
 */
export function terminalValue(value) {
  return terminalText(
    String(value).replace(/[\n\r\t]/g, (c) =>
      c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t',
    ),
  );
}
