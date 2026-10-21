import { createHash } from 'node:crypto';

// Content identity for a served view. A host or proxy that caches `ui://` resources by URI cannot
// tell that an application's HTML changed when the URI does not. The application derives the URI
// from the exact document it serves, so unchanged bytes keep their identity and any change gets a new one without losing its filename.

/**
 * Preserves the relative HTML filename in its resource URI and inserts the first 32 SHA-256
 * hex digits before the extension: `ui://views/answer.<fingerprint>.html`.
 *
 * Apply it to the final HTML, after every build, inlining or stamping step, and use the result as
 * `OperationView.uri`. The same filename and bytes always give the same URI; changing any byte, in the
 * application or in an SDK bundle inlined into it, gives a different one. A string is hashed as its
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
  const named = filename.replace(/\.html$/, `.${digest.slice(0, 32)}.html`);
  return `ui://views/${named.split('/').map(encodeURIComponent).join('/')}`;
}
