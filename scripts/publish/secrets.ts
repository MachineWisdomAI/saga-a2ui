import path from 'node:path';
import { fail, pass, type Finding } from './record.js';
import { expandArchives } from './nested-archives.js';
import type { ZipEntry } from './zip.js';

// What counts as a secret in anything a publication command writes or prints (CLI3 #66, CLI4 #67):
// the patterns, the names of the kinds found (never the value) and the redactor every output line
// passes through. Targets share it so a rule added for one cannot be missing from the other.

const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ['API key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
  [
    'GitHub token',
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/,
  ],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['PyPI token', /\bpypi-AgE[A-Za-z0-9_-]{50,}/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{34,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['Google OAuth token', /\bya29\.[A-Za-z0-9_-]{20,}/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{16,}/],
  ['Azure storage key', /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/],
  [
    'basic authorization',
    /\bAuthorization:\s*Basic\s+[A-Za-z0-9+/]{16,}={0,2}/i,
  ],
  // A user and password inside a URL, unless the password is an obvious placeholder.
  [
    'URL with credentials',
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:(?!(?:password|pass|secret|changeme|x+|\*+|<[^>\s]*>|\$\{?\w+\}?|\{\{[^}]*\}\})@)[^\s/@'"]{3,}@[^\s/'"]+/i,
  ],
  // A registry or container-registry login as `.npmrc` or `.docker/config.json` write it.
  [
    'registry credential',
    /(?:\b_(?:authToken|auth|password)\s*=\s*(?!\$\{)[^\s'"]{8,}|"auth"\s*:\s*"[A-Za-z0-9+/]{16,}={0,2}")/,
  ],
  [
    'JSON Web Token',
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  ],
  [
    'credential assignment',
    /["']?(?:client_?secret|api_?key|password|passwd|access_?token|auth_?token|private_?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  ],
  // An unquoted `NAME=value` line (a `.env` file, an AWS credentials file, a shell export). The
  // value must be long and mix letters with digits, so prose and `your-key-here` placeholders do
  // not match.
  [
    'credential assignment',
    /^[ \t]*(?:export[ \t]+)?["']?[\w.-]*(?:secret|token|passw(?:or)?d|api_?key|access_?key|private_?key|auth_?key)[\w.-]*["']?[ \t]*[:=][ \t]*(?=[\w/+=.~-]*\d)(?=[\w/+=.~-]*[A-Za-z])[\w/+=.~-]{16,}[ \t]*$/im,
  ],
];

/** Names of the kinds of secret found in text, never the secret itself. */
export function secretKinds(text: string): string[] {
  return [
    ...new Set(
      SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
        ([kind]) => kind,
      ),
    ),
  ];
}

/**
 * `text` with every secret-looking span and every literal credential this run holds replaced by a
 * marker. It is the last step before anything is printed: a finding's wording is built to carry no
 * secret, and this keeps a mistake in one of them from becoming a disclosure.
 */
export function redactSecrets(
  text: string,
  literals: readonly string[] = [],
): string {
  let redacted = text;
  for (const literal of literals)
    if (literal !== '')
      redacted = redacted.split(literal).join('[redacted credential]');
  for (const [kind, pattern] of SECRET_PATTERNS)
    redacted = redacted.replace(
      new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`),
      `[redacted ${kind}]`,
    );
  return redacted;
}

// File kinds that exist to hold credentials. A package has no use for one, and a file of this kind
// is refused by name even when its content matches no pattern (a key store is binary, an `.npmrc`
// may carry a token in a form no pattern knows). Public documentation of the format belongs in a
// file with another name; `.env.example` and its siblings are allowed.
const CREDENTIAL_DIRECTORIES = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  '.docker',
  '.kube',
]);
const CREDENTIAL_FILES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '_netrc',
  '.git-credentials',
  '.htpasswd',
  '.dockercfg',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);
const CREDENTIAL_EXTENSIONS = new Set([
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.kdbx',
  '.ppk',
]);
const ENVIRONMENT_TEMPLATE = /\.(?:example|sample|template|dist|defaults?)$/;

/** Whether an archive path names a file or folder that exists to hold credentials. */
export function isCredentialStore(entryPath: string): boolean {
  const parts = entryPath.split(/\/|!\//).filter((part) => part !== '');
  const base = (parts.at(-1) ?? '').toLowerCase();
  if (parts.slice(0, -1).some((part) => CREDENTIAL_DIRECTORIES.has(part)))
    return true;
  if (CREDENTIAL_FILES.has(base) || CREDENTIAL_DIRECTORIES.has(base))
    return true;
  if (CREDENTIAL_EXTENSIONS.has(path.extname(base))) return true;
  return (
    (base === '.env' || base.startsWith('.env.')) &&
    !ENVIRONMENT_TEMPLATE.test(base)
  );
}

// Every entry is read, whatever its name or extension: a credential can ride in a file named like
// an image, appended to real image data, or in a font. Bytes are decoded one to one (Latin-1) so
// that the ASCII runs a credential is made of survive in binary data; a file that opens with a
// UTF-16 byte order mark is decoded as UTF-16, since its text has a zero byte between letters.
function decode(data: Uint8Array): string {
  const bytes = Buffer.from(data);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  return bytes.toString('latin1');
}

/** The entries of an archive, decoded: what the secret scan reads. */
export function textEntries(
  entries: readonly ZipEntry[],
): { readonly path: string; readonly text: string }[] {
  return entries.map((one) => ({ path: one.path, text: decode(one.data) }));
}

/**
 * The finding about secrets in an archive. It reads the credential patterns in every entry,
 * including the members of zip, gzip and tar archives inside it (a bounded number of levels and
 * bytes deep), refuses file kinds that exist to hold credentials, and looks for the literal values
 * this run was given (a credential used for discovery) in any entry. An archive it cannot open is
 * a failure, not a pass. It names the file and the kind, never the value.
 *
 * This is a screen for common credential forms, not proof that none is present: a value that is
 * encoded, split, encrypted or in a format that is not recognised is not found.
 */
export function secretFinding(
  entries: readonly ZipEntry[],
  literals: readonly string[],
): Finding {
  const { entries: expanded, uninspected } = expandArchives(entries);
  const leaks: string[] = [];
  for (const { path: file, text } of textEntries(expanded)) {
    if (isCredentialStore(file))
      leaks.push(`${file} is a kind of file that holds credentials.`);
    const kinds = secretKinds(text);
    if (kinds.length > 0)
      leaks.push(`${file} contains what looks like a ${kinds.join(', ')}.`);
  }
  for (const entry of expanded)
    for (const literal of literals)
      if (literal !== '' && Buffer.from(entry.data).includes(literal))
        leaks.push(
          `${entry.path} contains the credential supplied for discovery.`,
        );
  if (leaks.length === 0 && uninspected.length === 0)
    return pass(
      'package.secrets',
      'No credential of a recognised form was found in the package or in the zip, gzip and tar archives inside it. This is a screen for common forms, not proof that none is present.',
    );
  return fail(
    'package.secrets',
    leaks.length > 0
      ? 'The package appears to contain a secret.'
      : 'The package holds an archive that could not be checked for secrets.',
    leaks.length > 0
      ? 'Remove the secret from the release input or its assets; credentials belong in the host portal.'
      : 'Remove the archive from the release input, or replace it with the plain files it holds. Only zip, gzip and tar archives within a fixed size and depth can be opened.',
    [...leaks, ...uninspected].join(' '),
  );
}
