import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  MAX_NESTED_BYTES,
  MAX_NESTED_DEPTH,
  MAX_NESTED_ENTRIES,
} from './nested-archives.js';
import {
  isCredentialStore,
  redactSecrets,
  secretFinding,
  secretKinds,
} from './secrets.js';
import { writeZip, type ZipEntry } from './zip.js';

// What the package secret scan finds and what it must leave alone. Every credential here is
// synthetic and assembled from parts, so no real-looking token sits in the repository.

const text = (value: string): Buffer => Buffer.from(value, 'utf8');
const entry = (path: string, value: string | Uint8Array): ZipEntry => ({
  path,
  data: typeof value === 'string' ? text(value) : value,
});
const fake = (prefix: string, length: number): string =>
  `${prefix}${'Ab3dEf7hJk'.repeat(Math.ceil(length / 10)).slice(0, length)}`;

/** A one-file tar (ustar). */
function tar(name: string, content: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(
    `${Buffer.byteLength(content).toString(8).padStart(11, '0')}\0`,
    124,
    'latin1',
  );
  header.write('0', 156, 'latin1');
  header.write('ustar\0', 257, 'latin1');
  const body = Buffer.alloc(Math.ceil(Buffer.byteLength(content) / 512) * 512);
  body.write(content, 'utf8');
  return Buffer.concat([header, body, Buffer.alloc(1024)]);
}

/** A ZIP with one deflated entry whose recorded size is `recorded`, whatever it really inflates to. */
function deflatedZip(data: Buffer, recorded: number): Buffer {
  const name = text('big.txt');
  const packed = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(recorded, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(recorded, 24);
  central.writeUInt16LE(name.length, 28);
  const body = Buffer.concat([local, name, packed]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, name, end]);
}

const verdict = (entries: readonly ZipEntry[], literals: string[] = []) => {
  const finding = secretFinding(entries, literals);
  return {
    failed: finding.status === 'fail',
    detail: finding.detail ?? '',
    title: finding.summary,
  };
};

const PNG_HEAD = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
]);

describe('credential forms the scan recognises', () => {
  it.each([
    ['a PGP private key block', '-----BEGIN PGP PRIVATE KEY BLOCK-----\n'],
    ['an npm token', `token ${fake('npm_', 36)}`],
    ['a GitLab token', fake('glpat-', 24)],
    ['a Google API key', fake('AIza', 35)],
    ['a Stripe live key', fake('sk_live_', 24)],
    ['an AWS session key', 'ASIA' + 'ABCDEFGHIJKLMNOP'],
    ['a registry login', '//registry.example.com/:_authToken=abcd1234efgh5678'],
    [
      'a container registry login',
      '{"auths":{"r":{"auth":"dXNlcjpwYXNzd29yZDEyMw=="}}}',
    ],
    [
      'a password in a URL',
      'git clone https://deploy:s3cretPw9@example.com/r.git',
    ],
    [
      'a basic authorization header',
      'Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==',
    ],
    ['an unquoted environment line', 'DATABASE_PASSWORD=Zx81qwErty2929ab\n'],
    [
      'an unquoted AWS credentials line',
      '[default]\naws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYzZ\n',
    ],
  ])('finds %s', (_name, content) => {
    expect(secretKinds(content)).not.toEqual([]);
    expect(redactSecrets(content)).toContain('[redacted');
  });

  it.each([
    'API_KEY=your-api-key-here',
    'TOKEN=<your token>',
    'PASSWORD=${PASSWORD}',
    'The token: expires soon, so refresh it before the call.',
    'password: required',
    'git clone https://user:password@example.com/r.git',
    'git clone https://user:${TOKEN}@example.com/r.git',
    'https://example.com/docs?x=1',
    '//registry.example.com/:_authToken=${NPM_TOKEN}',
    'Basic authentication is supported.',
  ])('leaves %j alone', (content) => {
    expect(secretKinds(content)).toEqual([]);
  });
});

describe('file kinds refused by name', () => {
  it.each([
    '.env',
    '.env.production',
    'skills/a/.npmrc',
    'skills/a/.git/config',
    'id_rsa',
    'keys/server.p12',
    'bundle.zip!/.aws/credentials',
  ])('refuses %s', (name) => expect(isCredentialStore(name)).toBe(true));

  it.each([
    '.env.example',
    '.env.sample',
    'README.md',
    'id_rsa.pub',
    'skills/a/SKILL.md',
    '.github/workflows/ci.yml',
    'environment.md',
  ])('allows %s', (name) => expect(isCredentialStore(name)).toBe(false));

  it('refuses a credential store whose content matches no pattern', () => {
    const result = verdict([
      entry('skills/a/.npmrc', 'registry=https://r.example\n'),
    ]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      'skills/a/.npmrc is a kind of file that holds credentials',
    );
  });
});

describe('what a file named like an image can carry', () => {
  const secret = `api_key = "${'synthetic'.repeat(3)}"`;

  it('finds a credential appended to binary image data', () => {
    const result = verdict([
      entry(
        'assets/logo.png',
        Buffer.concat([PNG_HEAD, text(`\n${secret}\n`)]),
      ),
    ]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      'assets/logo.png contains what looks like a credential assignment',
    );
    expect(result.detail).not.toContain('synthetic');
  });

  it('finds a UTF-16 text credential', () => {
    const data = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`${secret}\n`, 'utf16le'),
    ]);
    expect(verdict([entry('notes.txt', data)]).failed).toBe(true);
  });

  it('passes an ordinary image', () => {
    const bytes = Buffer.alloc(200_000);
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = (index * 131 + (index >> 8) * 17) & 0xff;
    expect(
      verdict([entry('assets/logo.png', Buffer.concat([PNG_HEAD, bytes]))])
        .failed,
    ).toBe(false);
  });
});

describe('archives inside the package', () => {
  const secret = `password = "${'synthetic'.repeat(3)}"`;
  const literal = 'discovery-credential-0123456789';

  it('finds a credential in a ZIP, a gzip and a tar', () => {
    for (const [name, data] of [
      ['skills/a/data.zip', writeZip([entry('config.ini', secret)])],
      ['skills/a/data.gz', gzipSync(text(secret))],
      ['skills/a/data.tar', tar('config.ini', secret)],
      ['skills/a/data.tgz', gzipSync(tar('config.ini', secret))],
    ] as const) {
      const result = verdict([entry(name, data)]);
      expect(result.failed, name).toBe(true);
      expect(result.detail, name).toContain(`${name}!/`);
      expect(result.detail, name).toContain('credential assignment');
      expect(result.detail, name).not.toContain('synthetic');
    }
  });

  it('finds a credential in an archive inside an archive', () => {
    const inner = writeZip([entry('deep/.env.local', 'x')]);
    const middle = writeZip([entry('inner.zip', inner)]);
    const result = verdict([entry('outer.zip', middle)]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain('outer.zip!/inner.zip!/deep/.env.local');
  });

  it('finds the credential supplied for discovery inside a compressed member', () => {
    const packed = deflatedZip(text(`x ${literal} y`), `x ${literal} y`.length);
    expect(verdict([entry('a.zip', packed)], [literal]).failed).toBe(true);
    expect(
      verdict([entry('a.gz', gzipSync(text(literal)))], [literal]).failed,
    ).toBe(true);
  });

  it('passes archives that hold only plain files', () => {
    const result = verdict([
      entry(
        'a.zip',
        writeZip([entry('notes.md', '# Notes\nNothing secret.\n')]),
      ),
      entry('b.tgz', gzipSync(tar('readme.txt', 'hello'))),
      entry('empty.zip', writeZip([])),
    ]);
    expect(result.failed).toBe(false);
  });

  it('does not treat a text file that mentions an archive as one', () => {
    expect(
      verdict([entry('notes.md', 'PK is in the name of the format.')]).failed,
    ).toBe(false);
  });

  it.each([
    ['xz', Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 1, 2, 3])],
    ['zstd', Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3])],
    ['7z', Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4])],
    ['RAR', Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0, 0])],
    [
      'bzip2',
      Buffer.from([0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59, 0x26, 0x53, 0x59]),
    ],
  ])(
    'refuses a %s archive it cannot open instead of passing it',
    (name, data) => {
      const result = verdict([entry(`skills/a/data.${name}`, data)]);
      expect(result.failed).toBe(true);
      expect(result.title).toContain('could not be checked');
      expect(result.detail).toContain(
        `skills/a/data.${name} is an archive in a format that cannot be opened`,
      );
    },
  );

  it('refuses an archive that is damaged or encrypted', () => {
    const damaged = Buffer.from(writeZip([entry('a.txt', 'hello')]));
    damaged.writeUInt32LE(0, damaged.length - 6);
    const encrypted = Buffer.from(writeZip([entry('a.txt', 'hello')]));
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(1, central + 8);
    for (const [name, data] of [
      ['damaged.zip', damaged],
      ['encrypted.zip', encrypted],
      ['broken.gz', Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3])],
    ] as const) {
      const result = verdict([entry(name, data)]);
      expect(result.failed, name).toBe(true);
      expect(result.detail, name).toContain(
        `${name} is an archive that could not be opened`,
      );
    }
  });

  it('stops at the depth limit', () => {
    let data = writeZip([entry('leaf.txt', 'plain text')]);
    for (let level = 0; level < MAX_NESTED_DEPTH; level += 1)
      data = writeZip([entry(`level${level}.zip`, data)]);
    const result = verdict([entry('top.zip', data)]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      `nested more than ${MAX_NESTED_DEPTH} levels deep`,
    );
  });

  it('stays inside the file budget', () => {
    const many = writeZip(
      Array.from({ length: MAX_NESTED_ENTRIES + 1 }, (_, index) =>
        entry(`f${index}.txt`, 'x'),
      ),
    );
    const result = verdict([entry('many.zip', many)]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      'many.zip is an archive that could not be opened',
    );
  });

  it('stays inside the byte budget for a stored, a deflated and a gzip member', () => {
    const big = Buffer.alloc(MAX_NESTED_BYTES + 1, 0x61);
    for (const [name, data] of [
      ['stored.zip', writeZip([entry('big.txt', big)])],
      ['deflated.zip', deflatedZip(big, big.length)],
      ['big.gz', gzipSync(big)],
    ] as const) {
      const result = verdict([entry(name, data)]);
      expect(result.failed, name).toBe(true);
      expect(result.detail, name).toContain(
        `${name} is an archive that could not be opened`,
      );
    }
  });

  it('refuses a ZIP whose recorded size understates what it inflates to', () => {
    const lying = deflatedZip(Buffer.alloc(5_000_000, 0x61), 10);
    const result = verdict([entry('bomb.zip', lying)]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      'bomb.zip is an archive that could not be opened',
    );
  });

  it('reports a hostile member name with printable characters only', () => {
    const result = verdict([
      entry('a.tgz', gzipSync(tar('x\u001b[31m.env', 'k'))),
    ]);
    expect(result.detail).not.toContain('\u001b');
  });
});

describe('the finding states its limits', () => {
  it('a pass does not claim that no credential exists', () => {
    const finding = secretFinding([entry('README.md', 'hello')], []);
    expect(finding.status).toBe('pass');
    expect(finding.summary).toMatch(/common forms, not proof/);
  });
});
