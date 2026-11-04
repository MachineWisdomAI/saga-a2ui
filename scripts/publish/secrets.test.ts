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

/** One tar member: a ustar header with a correct checksum, then the data padded to whole blocks. */
function tarMember(
  name: string,
  content: string | Buffer,
  type = '0',
  extra: { magic?: boolean; prefix?: string } = {},
): Buffer {
  const data = typeof content === 'string' ? text(content) : content;
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  header.write(type, 156, 'latin1');
  if (extra.magic !== false) header.write('ustar\0', 257, 'latin1');
  if (extra.prefix !== undefined) header.write(extra.prefix, 345, 'utf8');
  header.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(body);
  return Buffer.concat([header, body]);
}

const TAR_END = Buffer.alloc(1024);

/** A one-file tar (ustar). */
function tar(name: string, content: string): Buffer {
  return Buffer.concat([tarMember(name, content), TAR_END]);
}

/** A PAX extended-header record. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length)
    length = String(length).length + body.length;
  return `${length}${body}`;
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

  it('spends one cumulative byte budget across several gzip archives', () => {
    const full = gzipSync(Buffer.alloc(MAX_NESTED_BYTES, 0x61));
    const one = gzipSync(Buffer.from('b'));
    expect(verdict([entry('full.gz', full)]).failed).toBe(false);
    const result = verdict([entry('full.gz', full), entry('one.gz', one)]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      'one.gz is an archive that could not be opened',
    );
    expect(result.detail).not.toContain('full.gz');
  });

  it('refuses a gzip once the file budget is spent', () => {
    const many = writeZip(
      Array.from({ length: MAX_NESTED_ENTRIES }, (_, index) =>
        entry(`f${index}.txt`, 'x'),
      ),
    );
    const result = verdict([
      entry('many.zip', many),
      entry('late.gz', gzipSync(text('hello'))),
    ]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      'late.gz is an archive that could not be opened',
    );
  });

  it('refuses a gzip that expands past what is left of the budget', () => {
    const half = gzipSync(Buffer.alloc(MAX_NESTED_BYTES / 2 + 1, 0x61));
    const result = verdict([entry('a.gz', half), entry('b.gz', half)]);
    expect(result.failed).toBe(true);
    expect(result.detail).toContain(
      'b.gz is an archive that could not be opened',
    );
    expect(result.detail).not.toContain('a.gz');
  });

  describe('a tar is read as a whole or refused', () => {
    const secret = `password = "${fake('', 24)}"`;
    const refused = (name: string, data: Buffer) => {
      const result = verdict([entry(name, data)]);
      expect(result.failed, name).toBe(true);
      expect(result.detail, name).toContain(
        `${name} is an archive that could not be opened`,
      );
    };

    it('refuses a link, a device and an unknown member type', () => {
      for (const type of ['1', '2', '3', '4', '6', '7', 'S', 'Z'])
        refused(
          `type-${type}.tar`,
          Buffer.concat([tarMember('m', '', type), TAR_END]),
        );
    });

    it('refuses a header with a wrong checksum', () => {
      const data = tar('config.ini', secret);
      data[0] = data[0]! ^ 0x01;
      refused('sum.tar', data);
    });

    it('refuses an archive with no end marker, a single end block or trailing data', () => {
      const member = tarMember('config.ini', secret);
      refused('none.tar', member);
      refused('one.tar', Buffer.concat([member, Buffer.alloc(512)]));
      refused(
        'junk.tar',
        Buffer.concat([member, TAR_END, Buffer.from('trailing data')]),
      );
    });

    it('refuses truncated data and a damaged size', () => {
      const data = tar('config.ini', 'x'.repeat(2000));
      refused('short.tar', data.subarray(0, 1200));
      const size = tarMember('a', 'x');
      size.write('9999999\0', 124, 'latin1');
      refused('size.tar', Buffer.concat([size, TAR_END]));
    });

    it('names a member by its PAX path and applies the credential-store rule to it', () => {
      const data = Buffer.concat([
        tarMember('PaxHeader', paxRecord('path', 'conf/.env'), 'x'),
        tarMember('harmless.txt', 'hello'),
        TAR_END,
      ]);
      const result = verdict([entry('p.tar', data)]);
      expect(result.failed).toBe(true);
      expect(result.detail).toContain(
        'p.tar!/conf/.env is a kind of file that holds credentials',
      );
    });

    it('names a member by its GNU long name', () => {
      const data = Buffer.concat([
        tarMember('././@LongLink', 'deep/.npmrc\0', 'L'),
        tarMember('short.txt', 'hello'),
        TAR_END,
      ]);
      expect(verdict([entry('g.tar', data)]).detail).toContain(
        'g.tar!/deep/.npmrc is a kind of file that holds credentials',
      );
    });

    it('names a member by its ustar prefix', () => {
      const data = Buffer.concat([
        tarMember('.env', 'hello', '0', { prefix: 'conf' }),
        TAR_END,
      ]);
      expect(verdict([entry('u.tar', data)]).detail).toContain(
        'u.tar!/conf/.env is a kind of file that holds credentials',
      );
    });

    it('finds a credential in a member named through a long-name header', () => {
      const data = Buffer.concat([
        tarMember(
          'PaxHeader',
          paxRecord('path', `${'d/'.repeat(80)}f.ini`),
          'x',
        ),
        tarMember('f.ini', secret),
        TAR_END,
      ]);
      const result = verdict([entry('long.tar', data)]);
      expect(result.failed).toBe(true);
      expect(result.detail).toContain(
        'what looks like a credential assignment',
      );
    });

    it('accepts well-formed PAX metadata that does not change how data is read', () => {
      const data = Buffer.concat([
        tarMember('Global', paxRecord('comment', 'a commit id'), 'g'),
        tarMember(
          'PaxHeader',
          paxRecord('mtime', '1700000000.5') + paxRecord('path', 'docs/a.txt'),
          'x',
        ),
        tarMember('a.txt', 'hello'),
        tarMember('docs/', '', '5'),
        TAR_END,
      ]);
      expect(verdict([entry('ok.tar', data)]).failed).toBe(false);
    });

    it('refuses PAX records that are damaged or that change the data layout', () => {
      const pax = (body: string, type = 'x') =>
        Buffer.concat([
          tarMember('PaxHeader', body, type),
          tarMember('a.txt', 'hello'),
          TAR_END,
        ]);
      refused('bad-length.tar', pax('99 path=a\n'));
      refused('no-equals.tar', pax('12 nothing x\n'));
      refused('size.tar', pax(paxRecord('size', '1')));
      refused('sparse.tar', pax(paxRecord('GNU.sparse.map', '0,1')));
      refused('charset.tar', pax(paxRecord('hdrcharset', 'BINARY')));
      refused('global-path.tar', pax(paxRecord('path', 'x'), 'g'));
      refused(
        'dangling.tar',
        Buffer.concat([
          tarMember('PaxHeader', paxRecord('path', 'x'), 'x'),
          TAR_END,
        ]),
      );
    });

    it('refuses a member path outside the archive root', () => {
      refused('up.tar', tar('../escape.txt', 'hello'));
      refused('abs.tar', tar('/etc/passwd', 'hello'));
    });

    it('opens a tar that has no ustar magic, and refuses it when damaged', () => {
      const old = Buffer.concat([
        tarMember('config.ini', secret, '0', { magic: false }),
        TAR_END,
      ]);
      const result = verdict([entry('old.tar', old)]);
      expect(result.failed).toBe(true);
      expect(result.detail).toContain('old.tar!/config.ini contains');
      refused('old-short.tar', old.subarray(0, 600));
    });
  });

  it('reports a hostile member name with printable characters only', () => {
    const secret = `password = "${fake('', 24)}"`;
    const hostile = 'x\u001b[31m\u0007\u202e';
    for (const [label, entries, expected] of [
      [
        'secret in tar',
        [entry('a.tgz', gzipSync(tar(`${hostile}.ini`, secret)))],
        'a.tgz!/content!/x?[31m??.ini contains what looks like a credential assignment',
      ],
      [
        'credential store in tar',
        [entry('a.tgz', gzipSync(tar(`${hostile}/.env`, 'k')))],
        'a.tgz!/content!/x?[31m??/.env is a kind of file that holds credentials',
      ],
      [
        'secret in zip',
        [entry(`${hostile}.ini`, secret)],
        'x?[31m??.ini contains what looks like a credential assignment',
      ],
      [
        'discovery credential',
        [entry(`${hostile}.txt`, 'plain-literal-credential')],
        'x?[31m??.txt contains the credential supplied for discovery',
      ],
    ] as const) {
      const result = verdict(entries, ['plain-literal-credential']);
      expect(result.failed, label).toBe(true);
      expect(result.detail, label).toContain(expected);
      expect(result.detail, label).not.toMatch(/[^\x20-\x7e]/);
    }
  });
});

describe('the finding states its limits', () => {
  it('a pass does not claim that no credential exists', () => {
    const finding = secretFinding([entry('README.md', 'hello')], []);
    expect(finding.status).toBe('pass');
    expect(finding.summary).toMatch(/common forms, not proof/);
  });
});
