import path from 'node:path';
import { fail, pass, type Finding } from './record.js';
import type { ZipEntry } from './zip.js';

// What counts as a secret in anything a publication command writes or prints (CLI3 #66, CLI4 #67):
// the patterns, the names of the kinds found (never the value) and the redactor every output line
// passes through. Targets share it so a rule added for one cannot be missing from the other.

const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ['API key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['credential assignment', /["']?(?:client_?secret|api_?key|password|passwd|access_?token|auth_?token|private_?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];

/** Names of the kinds of secret found in text, never the secret itself. */
export function secretKinds(text: string): string[] {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

/**
 * `text` with every secret-looking span and every literal credential this run holds replaced by a
 * marker. It is the last step before anything is printed: a finding's wording is built to carry no
 * secret, and this keeps a mistake in one of them from becoming a disclosure.
 */
export function redactSecrets(text: string, literals: readonly string[] = []): string {
  let redacted = text;
  for (const literal of literals) if (literal !== '') redacted = redacted.split(literal).join('[redacted credential]');
  for (const [kind, pattern] of SECRET_PATTERNS) redacted = redacted.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), `[redacted ${kind}]`);
  return redacted;
}

// Raster and font formats that are binary by construction. Everything else an archive carries is
// scanned: a bundled skill tree can hold any file (.py, .env, a file with no extension, a LICENSE),
// and a credential in one of them must not ride in a ready archive. A file with one of these
// extensions is skipped only when it really is binary (it holds a NUL byte); a text file merely
// named like an image is scanned.
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.zip']);

const isBinaryEntry = (entry: ZipEntry): boolean => BINARY_EXTENSIONS.has(path.extname(entry.path).toLowerCase()) && Buffer.from(entry.data).includes(0);

/** The entries of an archive that are text, decoded: what the secret scan reads. */
export function textEntries(entries: readonly ZipEntry[]): { readonly path: string; readonly text: string }[] {
  return entries.filter((one) => !isBinaryEntry(one)).map((one) => ({ path: one.path, text: Buffer.from(one.data).toString('utf8') }));
}

/**
 * The finding about secrets in an archive: credential patterns in its text, and the literal values
 * this run was given (a credential used for discovery) anywhere in any entry. It names the file and
 * the kind, never the value.
 */
export function secretFinding(entries: readonly ZipEntry[], literals: readonly string[]): Finding {
  const leaks: string[] = [];
  for (const { path: file, text } of textEntries(entries)) {
    const kinds = secretKinds(text);
    if (kinds.length > 0) leaks.push(`${file} contains what looks like a ${kinds.join(', ')}.`);
  }
  for (const entry of entries) for (const literal of literals) if (literal !== '' && Buffer.from(entry.data).includes(literal)) leaks.push(`${entry.path} contains the credential supplied for discovery.`);
  return leaks.length === 0
    ? pass('package.secrets', 'No credential was found in the package.')
    : fail('package.secrets', 'The package appears to contain a secret.', 'Remove the secret from the release input or its assets; credentials belong in the host portal.', leaks.join(' '));
}
