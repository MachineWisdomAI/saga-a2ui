import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  createWorkDirectory,
  packSdkPackages,
  repoRoot,
  candidateVersion,
  sourceRevision,
} from './packed-consumer.js';

// Linking workspace node_modules cannot detect incorrect pnpm peer contexts. Separate consumers
// are installed outside the workspace with pnpm 10 and strict peers, each from the packed candidate
// tarballs, and compiled with real types (no casts, aliases or skipLibCheck):
//
// 1. `lower-level`: the application names every SDK package itself and compiles against the
//    renderer, core and MCP contracts directly (the arrangement before the stacks, still supported).
//    Its claim is only that this arrangement installs and compiles; it says nothing of a stack.
// 2. `stack-only` (React, then Lit): the application names ONLY its stack and the stack's
//    framework peers (react and react-dom; lit). Its catalog, actions, layout, failures and
//    server composition are all written against stack exports; it declares no upstream renderer
//    or schema package, no Zod and no other SDK package. The stack's own dependencies (renderer
//    adapter, upstream renderer, MCP, core, components, ext-apps) arrive beneath it, resolved to
//    the unpublished tarballs by sibling overrides, which are never direct dependencies. The
//    consumer imports every stack entry, and the installed tree is then checked for what the stack
//    declares (components and markdown-it are present, which is the correct install result; the
//    emitted-bundle footprint of an own-catalog application is a different check, on built
//    output), for exact sibling resolution, for the stack's full framework peer requirements and
//    for one runtime of each framework package. The stack's `/server` entry is compiled here under
//    the full application peer recipe; it is a convenience for an application that already
//    installs the stack, and it does not make the stack renderer-free.
// 3. `server-only`: an independently installable server names `@saga-a2ui/mcp`, the MCP server
//    package and Zod. No renderer, stack or components package is installed, no peer is
//    required, and the same strict install compiles `@saga-a2ui/mcp/server`.

const BUILD_TOOLS = { typescript: '5.9.3', '@types/node': '22.20.5' };

interface StackSpec {
  readonly stack: string;
  readonly description: string;
  /** The framework peers the application installs and the stack must declare, exactly. */
  readonly peers: Record<string, string>;
  /** What the stack declares, and so what the installed tree must contain beneath it. */
  readonly declared: readonly string[];
  /** Installed beneath the stack, asked to resolve the application's framework packages. */
  readonly askers: readonly string[];
  /** Each of these has exactly one installed copy in the whole tree. */
  readonly singleRuntimes: readonly string[];
  readonly entries: readonly string[];
  readonly stylesheet?: string;
  readonly development: Record<string, string>;
  readonly fixture: string;
  readonly jsx: boolean;
}

const REACT_STACK: StackSpec = {
  stack: '@saga-a2ui/react-mcp-stack',
  description: 'React',
  peers: { react: '19.3.1', 'react-dom': '19.3.1' },
  declared: [
    '@saga-a2ui/components',
    '@saga-a2ui/core',
    '@saga-a2ui/mcp',
    '@saga-a2ui/react',
    '@modelcontextprotocol/ext-apps',
  ],
  askers: ['@saga-a2ui/react', 'react-dom'],
  singleRuntimes: ['react', 'react-dom'],
  entries: ['server', 'content-policy', 'faithful-card'],
  stylesheet: 'faithful-card.css',
  development: {
    ...BUILD_TOOLS,
    '@types/react': '19.3.0',
    '@types/react-dom': '19.3.0',
  },
  fixture: 'react-stack-consumer.tsx',
  jsx: true,
};

const LIT_STACK: StackSpec = {
  stack: '@saga-a2ui/lit-mcp-stack',
  description: 'Lit',
  peers: { lit: '^3.3.3' },
  declared: [
    '@saga-a2ui/components',
    '@saga-a2ui/core',
    '@saga-a2ui/lit',
    '@saga-a2ui/mcp',
    '@a2ui/lit',
    '@a2ui/web_core',
    '@modelcontextprotocol/ext-apps',
  ],
  askers: ['@saga-a2ui/lit', '@a2ui/lit'],
  singleRuntimes: ['lit', 'lit-html', 'lit-element', '@lit/reactive-element'],
  entries: ['server', 'content-policy', 'faithful-card'],
  development: BUILD_TOOLS,
  fixture: 'lit-stack-consumer.ts',
  jsx: false,
};

/** Installed in a server-only application: no renderer, stack or card package, and no framework peer. */
const ABSENT_FROM_SERVER_ONLY = [
  /^react(-dom)?$/,
  /^@a2ui\/(lit|react)$/,
  /^@saga-a2ui\/(react|lit|components|react-mcp-stack|lit-mcp-stack)$/,
  /^markdown-it$/,
];

function fail(message: string): never {
  throw new Error(`pnpm qualification failed: ${message}`);
}

function writeApp(
  app: string,
  options: {
    readonly dependencies: Record<string, string>;
    readonly development: Record<string, string>;
    readonly overrides: Record<string, string>;
    readonly fixture: string;
    readonly jsx: boolean;
  },
): void {
  fs.mkdirSync(app);
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      packageManager: 'pnpm@10.33.0',
      dependencies: options.dependencies,
      devDependencies: options.development,
    }),
  );
  // Sibling overrides resolve unpublished tarballs only. Markdown is the documented consumer setting.
  fs.writeFileSync(
    path.join(app, 'pnpm-workspace.yaml'),
    'packages: []\noverrides:\n' +
      Object.entries({
        ...JSON.parse(
          fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
        ).overrides,
        ...options.overrides,
      })
        .map(([name, file]) => `  "${name}": "${file}"\n`)
        .join(''),
  );
  const consumer = options.jsx ? 'consumer.tsx' : 'consumer.ts';
  fs.copyFileSync(
    path.join(repoRoot, 'scripts/fixtures', options.fixture),
    path.join(app, consumer),
  );
  fs.writeFileSync(
    path.join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        ...(options.jsx ? { jsx: 'react-jsx' } : {}),
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: [consumer],
    }),
  );
}

const pnpm = (app: string, args: string[]): void => {
  execFileSync('pnpm', args, { cwd: app, stdio: 'inherit' });
};

const real = (p: string): string => fs.realpathSync(p);

interface ListedPackage {
  readonly path?: string;
  readonly dependencies?: Record<string, ListedPackage>;
}

/** Every package installed beneath the application, who declares it, and where it lives, from pnpm's own listing. */
function installedTree(
  app: string,
  dependents?: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const listing = JSON.parse(
    execFileSync('pnpm', ['ls', '--depth', 'Infinity', '--json'], {
      cwd: app,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as Array<{ dependencies?: Record<string, ListedPackage> }>;
  const found = new Map<string, Set<string>>();
  const visit = (
    dependencies: Record<string, ListedPackage> = {},
    parent = '(application)',
  ): void => {
    for (const [name, entry] of Object.entries(dependencies)) {
      const paths = found.get(name) ?? new Set<string>();
      if (entry.path !== undefined) paths.add(real(entry.path));
      found.set(name, paths);
      const parents = dependents?.get(name) ?? new Set<string>();
      parents.add(parent);
      dependents?.set(name, parents);
      visit(entry.dependencies, name);
    }
  };
  for (const project of listing) visit(project.dependencies);
  return found;
}

interface ApplicationManifest {
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

const readManifest = (app: string): ApplicationManifest =>
  JSON.parse(
    fs.readFileSync(path.join(app, 'package.json'), 'utf8'),
  ) as ApplicationManifest;

const versionOf = (directory: string): string =>
  (
    JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
    ) as { version: string }
  ).version;

function assertDeclared(
  app: string,
  dependencies: readonly string[],
  development: Record<string, string>,
  what: string,
): void {
  const manifest = readManifest(app);
  const direct = Object.keys(manifest.dependencies).sort();
  if (JSON.stringify(direct) !== JSON.stringify([...dependencies].sort()))
    fail(
      `${what} must declare only ${dependencies.join(', ')} (got ${direct.join(', ')})`,
    );
  // Development tools are the application's own and separate: types and a compiler, nothing of the SDK.
  const tools = Object.keys(manifest.devDependencies).sort();
  if (JSON.stringify(tools) !== JSON.stringify(Object.keys(development).sort()))
    fail(
      `${what} may keep only its type and build tools as development dependencies (got ${tools.join(', ')})`,
    );
}

function assertStackOnlyFootprint(app: string, spec: StackSpec): void {
  const { stack: STACK } = spec;
  // The application's own declarations: the stack and the framework peers, exactly. Not another
  // SDK package, not upstream's renderer or schema packages, not Zod and not ext-apps: the stack
  // exports what an own catalog is written against.
  assertDeclared(
    app,
    [STACK, ...Object.keys(spec.peers)],
    spec.development,
    `the ${spec.description} application`,
  );

  const tree = installedTree(app);
  const stack = real(path.join(app, 'node_modules', ...STACK.split('/')));
  const stackManifest = JSON.parse(
    fs.readFileSync(path.join(stack, 'package.json'), 'utf8'),
  ) as { peerDependencies?: Record<string, string> };
  // The stack asks for every framework peer the application supplies, and no other.
  if (
    JSON.stringify(Object.keys(stackManifest.peerDependencies ?? {}).sort()) !==
    JSON.stringify(Object.keys(spec.peers).sort())
  )
    fail(
      `the ${spec.description} stack must declare exactly the framework peers the application installs`,
    );
  // A dependency of the stack sits beside it in pnpm's virtual store.
  const beneathStack = (name: string): string => {
    const sibling = name.startsWith('@saga-a2ui/')
      ? path.join(path.dirname(stack), name.slice('@saga-a2ui/'.length))
      : path.join(path.dirname(path.dirname(stack)), name);
    if (!fs.existsSync(sibling))
      fail(`${name} is not installed beneath the stack`);
    return real(sibling);
  };

  // 1. What the stack declares is installed beneath it, components and markdown-it included.
  for (const name of spec.declared) {
    const installed = beneathStack(name);
    if (!tree.has(name)) fail(`${name} is missing from the installed tree`);
    // Each sibling is the candidate tarball of the stack's own revision, not a published copy.
    if (
      name.startsWith('@saga-a2ui/') &&
      versionOf(installed) !== versionOf(stack)
    )
      fail(`${name} is not the same candidate build as the stack`);
  }
  const components = beneathStack('@saga-a2ui/components');
  if (
    !tree.has('markdown-it') ||
    !fs.existsSync(
      path.join(path.dirname(path.dirname(components)), 'markdown-it'),
    )
  )
    fail('markdown-it is not installed beneath components');

  // 2. One runtime of each framework package, whoever asks: the application, the stack and what
  // renders beneath it.
  const require = createRequire(path.join(app, 'package.json'));
  const resolveFrom = (from: string, name: string): string =>
    real(createRequire(path.join(from, 'package.json')).resolve(name));
  const askers: Record<string, string> = { stack };
  for (const name of spec.askers)
    askers[name] = name.startsWith('@')
      ? beneathStack(name)
      : path.dirname(real(require.resolve(`${name}/package.json`)));
  for (const [who, from] of Object.entries(askers))
    for (const peer of Object.keys(spec.peers)) {
      if (who === peer) continue;
      if (resolveFrom(from, peer) !== real(require.resolve(peer)))
        fail(`${who} resolves a different ${peer} than the application`);
    }
  for (const runtime of spec.singleRuntimes) {
    const copies = tree.get(runtime) ?? new Set<string>();
    if (copies.size !== 1)
      fail(`expected one ${runtime} in the tree, found ${copies.size}`);
    const prefix = runtime.replace('/', '+');
    const directories = fs
      .readdirSync(path.join(app, 'node_modules', '.pnpm'))
      .filter((entry) => entry.startsWith(`${prefix}@`));
    if (directories.length !== 1)
      fail(
        `expected one ${prefix}@ directory in the store, found ${directories.join(', ')}`,
      );
  }

  // 3. The stack's stylesheet export resolves from the application, inside the installed stack.
  if (spec.stylesheet !== undefined) {
    const stylesheet = real(require.resolve(`${STACK}/${spec.stylesheet}`));
    if (!stylesheet.startsWith(stack))
      fail('the card stylesheet does not resolve inside the installed stack');
  }

  // 4. The composition entries resolve from the application, each inside the installed stack: the
  // server entry and the content-policy entry are subpaths of the one package the application
  // installs, not packages of their own.
  for (const entry of spec.entries) {
    const resolved = real(require.resolve(`${STACK}/${entry}`));
    if (!resolved.startsWith(stack))
      fail(`${STACK}/${entry} does not resolve inside the installed stack`);
  }

  console.log(
    `${spec.description} stack-only footprint: ${spec.declared.join(', ')} and markdown-it installed beneath the stack; one runtime of ${spec.singleRuntimes.join(', ')}; the ${spec.entries.join(', ')} entries resolve inside the stack.`,
  );
}

function assertServerOnlyFootprint(app: string): void {
  assertDeclared(
    app,
    ['@modelcontextprotocol/server', '@saga-a2ui/mcp', 'zod'],
    BUILD_TOOLS,
    'the server-only application',
  );
  const dependents = new Map<string, Set<string>>();
  const tree = installedTree(app, dependents);
  for (const required of ['@saga-a2ui/mcp', '@saga-a2ui/core'])
    if (!tree.has(required))
      fail(`${required} is missing from the installed tree`);
  const present = [...tree.keys()].filter((name) =>
    ABSENT_FROM_SERVER_ONLY.some((pattern) => pattern.test(name)),
  );
  if (present.length > 0)
    fail(
      `a server-only application must install no renderer, stack or card package (found ${present.join(', ')})`,
    );
  // `lit` is not a renderer package of the SDK: upstream's renderer-neutral `@a2ui/web_core`, which
  // core declares, depends on it. It is installed beneath that package only, never asked for by
  // the application or by an SDK package, and the install needs no peer of any framework.
  const LIT_FAMILY = /^(lit(-html|-element)?|@lit(-labs)?\/.*)$/;
  for (const [name, parents] of dependents)
    if (LIT_FAMILY.test(name))
      for (const parent of parents)
        if (parent !== '@a2ui/web_core' && !LIT_FAMILY.test(parent))
          fail(`${parent} asks for ${name} in a server-only application`);
  console.log(
    'server-only footprint: @saga-a2ui/mcp/server installed and compiled with no renderer, stack, components or Markdown package in the tree; lit arrives only beneath upstream web_core, a dependency of core.',
  );
}

function qualifyStack(
  work: string,
  spec: StackSpec,
  tarballs: Record<string, string>,
): void {
  const only = path.join(
    work,
    `${spec.description.toLowerCase()}-stack-consumer`,
  );
  writeApp(only, {
    dependencies: {
      [spec.stack]:
        tarballs[spec.stack] ?? fail(`${spec.stack} was not packed`),
      ...spec.peers,
    },
    development: spec.development,
    overrides: tarballs,
    fixture: spec.fixture,
    jsx: spec.jsx,
  });
  pnpm(only, ['install', '--strict-peer-dependencies', '--ignore-scripts']);
  pnpm(only, ['exec', 'tsc', '--noEmit']);
  assertStackOnlyFootprint(only, spec);
  console.log(
    `${spec.description} stack pnpm consumer: strict peers, typecheck, installed footprint and single runtime passed from the stack and its framework peers alone.`,
  );
}

const work = createWorkDirectory('saga-react-pnpm-');
try {
  const revision = sourceRevision();
  const packed = packSdkPackages(
    work,
    [
      'core',
      'components',
      'mcp',
      'react',
      'react-mcp-stack',
      'lit',
      'lit-mcp-stack',
    ],
    path.join(work, 'tarballs'),
    candidateVersion(revision.commit, revision.dirty),
  );
  const tarballs = Object.fromEntries(
    packed.map((p) => [`@saga-a2ui/${p.name}`, `file:${p.tarball}`]),
  );

  // 1. Lower-level peers: every SDK package is the application's own dependency.
  const lower = path.join(work, 'consumer');
  writeApp(lower, {
    dependencies: {
      ...tarballs,
      '@modelcontextprotocol/ext-apps': '2.0.3',
      ...REACT_STACK.peers,
      zod: '4.6.7',
    },
    development: REACT_STACK.development,
    overrides: tarballs,
    fixture: 'react-peer-consumer.tsx',
    jsx: true,
  });
  pnpm(lower, ['install', '--strict-peer-dependencies', '--ignore-scripts']);
  pnpm(lower, ['exec', 'tsc', '--noEmit']);
  console.log(
    'React/MCP pnpm consumer: strict peers and typecheck passed without direct A2UI dependencies.',
  );

  // 2. Stack only: the stack and its framework peers. Every other SDK and upstream package is
  // reached through the stack.
  qualifyStack(work, REACT_STACK, tarballs);
  qualifyStack(work, LIT_STACK, tarballs);

  // 3. Server only: the delivery package's server export with no renderer anywhere.
  const server = path.join(work, 'server-consumer');
  writeApp(server, {
    dependencies: {
      '@saga-a2ui/mcp':
        tarballs['@saga-a2ui/mcp'] ?? fail('mcp was not packed'),
      '@modelcontextprotocol/server': '2.3.1',
      zod: '4.6.7',
    },
    development: BUILD_TOOLS,
    overrides: tarballs,
    fixture: 'mcp-server-consumer.ts',
    jsx: false,
  });
  pnpm(server, ['install', '--strict-peer-dependencies', '--ignore-scripts']);
  pnpm(server, ['exec', 'tsc', '--noEmit']);
  assertServerOnlyFootprint(server);
  console.log(
    'Server-only pnpm consumer: strict install and typecheck passed with no renderer package or peer.',
  );
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
