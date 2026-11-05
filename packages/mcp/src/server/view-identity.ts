import { createHash } from 'node:crypto';

// Identity for a served view. `viewUriForMajor` names a view by the major version of its contract,
// so a compatible rebuild keeps its address and a host holding an earlier tool descriptor still
// reads a document that is served. `viewUriForHtml` names a view by its exact bytes; it remains available
// as a content digest, for example to confirm that a deployment serves a given build.

/**
 * Returns the address of a view on one compatibility line: the relative HTML filename with
 * `v<major>` before the extension, `ui://views/answer.v1.html`. Directories in the filename stay
 * in the address, and each segment is percent-encoded.
 *
 * `major` is the major version of the contract between the application's tools and its view (what
 * the view reads from a result and what its actions send and expect back). Keep it for every
 * compatible rebuild, including a new build stamp in the document; increase it only for an
 * incompatible change. It must be a safe integer of at least 1: version 1 is the first line.
 *
 * The address does not identify particular bytes: every build on one major is served under it.
 * Two different documents on one server need two filenames.
 */
export function viewUriForMajor(filename: string, major: number): string {
  checkViewFilename(filename);
  if (typeof major !== 'number' || !Number.isSafeInteger(major) || major < 1) {
    throw new TypeError(
      'The view major must be a whole number of at least 1 (version 1 is the first line).',
    );
  }
  return addressFor(filename.replace(/\.html$/, `.v${major}.html`));
}

/**
 * Preserves the relative HTML filename in its resource URI and inserts the first 32 SHA-256
 * hex digits before the extension: `ui://views/answer.<fingerprint>.html`.
 *
 * Apply it to the final HTML, after every build, inlining or stamping step. The same filename and
 * bytes always give the same URI; changing any byte, in the application or in an SDK bundle inlined
 * into it, gives a different one. `operationViewFromHtml` addresses a view by its major instead
 * (`viewUriForMajor`), so this digest suits checking which build a deployment serves, not naming a
 * view whose document carries a per-release stamp. A string is hashed as its
 * UTF-8 encoding, which is what the connector serves; pass a `Uint8Array` to hash bytes you hold.
 *
 * Limits: the URI identifies only the bytes supplied. It does not authenticate the document, say
 * who built it, or cover anything served beside it (the declared CSP). A string with an unpaired
 * surrogate has no faithful UTF-8 encoding, so it throws `RangeError` rather than being hashed
 * with a substituted character. There is no registry or state: calling it again with the same bytes
 * and filename is the only way to recover an identity.
 */
export function viewUriForHtml(
  html: string | Uint8Array,
  filename: string,
): string {
  checkViewFilename(filename);
  const bytes = typeof html === 'string' ? Buffer.from(html, 'utf8') : html;
  // Encoding replaces an unpaired surrogate with U+FFFD, so a string that does not survive the round trip had no exact bytes.
  if (
    typeof html === 'string' &&
    Buffer.from(bytes).toString('utf8') !== html
  ) {
    throw new RangeError(
      'The HTML contains an unpaired surrogate, so it has no exact UTF-8 bytes to identify.',
    );
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  return addressFor(
    filename.replace(/\.html$/, `.${digest.slice(0, 32)}.html`),
  );
}

function checkViewFilename(filename: string): void {
  if (
    typeof filename !== 'string' ||
    !filename.endsWith('.html') ||
    filename.includes('\\') ||
    /^[a-zA-Z]:/.test(filename) ||
    filename
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..') ||
    filename.split('/').at(-1) === '.html'
  ) {
    throw new TypeError(
      'The view filename must be a relative HTML file without empty or traversal segments.',
    );
  }
}

function addressFor(named: string): string {
  return `ui://views/${named.split('/').map(encodeURIComponent).join('/')}`;
}
