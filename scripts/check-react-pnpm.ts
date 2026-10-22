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

// Linking workspace node_modules cannot detect incorrect pnpm peer contexts. Two separate consumers
// are installed outside the workspace with strict peers, each from the packed candidate tarballs:
//
// 1. `lower-level`: the application names every SDK package itself and compiles against the
//    renderer, core and MCP contracts directly (the arrangement before the stacks, still supported).
// 2. `stack-only`: the application names ONLY the React stack, React and the upstream packages its
//    own catalog is written against. The stack's own dependencies (renderer adapter, MCP, core,
//    components, ext-apps) arrive beneath it, resolved to the unpublished tarballs by sibling
//    overrides; the application never lists them. The consumer imports both stack entries, and the
//    installed tree is then checked for what the stack declares (components and markdown-it are
//    present, which is the correct install result; the emitted-bundle footprint of an own-catalog
//    application is a different check, on built output) and for one React runtime.

const PEERS = { react: '19.3.1', 'react-dom': '19.3.1' };
const DEV = {
  typescript: '5.9.3',
  '@types/node': '22.20.5',
  '@types/react': '19.3.0',
  '@types/react-dom': '19.3.0',
};
const STACK = '@saga-a2ui/react-mcp-stack';

/** What the stack declares, and so what the installed tree must contain beneath it. */
const STACK_DECLARED = [
  '@saga-a2ui/components',
  '@saga-a2ui/core',
  '@saga-a2ui/mcp',
  '@saga-a2ui/react',
  '@modelcontextprotocol/ext-apps',
];

function fail(message: string): never {
  throw new Error(`pnpm qualification failed: ${message}`);
}

function writeApp(
  app: string,
  options: {
    readonly dependencies: Record<string, string>;
    readonly overrides: Record<string, string>;
    readonly fixture: string;
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
      devDependencies: DEV,
    }),
  );
  // Sibling overrides resolve unpublished tarballs only. Markdown is the documented consumer setting.
  fs.writeFileSync(
    path.join(app, 'pnpm-workspace.yaml'),
    'packages: []\noverrides:\n' +
      Object.entries(options.overrides)
        .map(([name, file]) => `  "${name}": "${file}"\n`)
        .join('') +
      '  "@a2ui/markdown-it": "0.2.1"\n',
  );
  fs.copyFileSync(
    path.join(repoRoot, 'scripts/fixtures', options.fixture),
    path.join(app, 'consumer.tsx'),
  );
  fs.writeFileSync(
    path.join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['consumer.tsx'],
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

/** Every package installed beneath the application and where it lives, from pnpm's own listing. */
function installedTree(app: string): Map<string, Set<string>> {
  const listing = JSON.parse(
    execFileSync('pnpm', ['ls', '--depth', 'Infinity', '--json'], {
      cwd: app,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as Array<{ dependencies?: Record<string, ListedPackage> }>;
  const found = new Map<string, Set<string>>();
  const visit = (dependencies: Record<string, ListedPackage> = {}): void => {
    for (const [name, entry] of Object.entries(dependencies)) {
      const paths = found.get(name) ?? new Set<string>();
      if (entry.path !== undefined) paths.add(real(entry.path));
      found.set(name, paths);
      visit(entry.dependencies);
    }
  };
  for (const project of listing) visit(project.dependencies);
  return found;
}

function assertStackOnlyFootprint(app: string): void {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(app, 'package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> };
  // The application's own declarations: the stack, the framework peers and the upstream packages
  // its own catalog is written against. No other SDK package, and not ext-apps.
  const direct = Object.keys(manifest.dependencies).sort();
  const expectedDirect = [
    '@a2ui/react',
    '@a2ui/web_core',
    STACK,
    'zod',
    ...Object.keys(PEERS),
  ].sort();
  if (JSON.stringify(direct) !== JSON.stringify(expectedDirect))
    fail(
      `the application must declare only the stack, React and what its own catalog is written against (got ${direct.join(', ')})`,
    );

  const tree = installedTree(app);
  const stack = real(path.join(app, 'node_modules', ...STACK.split('/')));
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
  for (const name of STACK_DECLARED) {
    beneathStack(name);
    if (!tree.has(name)) fail(`${name} is missing from the installed tree`);
  }
  const components = beneathStack('@saga-a2ui/components');
  if (
    !tree.has('markdown-it') ||
    !fs.existsSync(
      path.join(path.dirname(path.dirname(components)), 'markdown-it'),
    )
  )
    fail('markdown-it is not installed beneath components');

  // 2. One React runtime, whoever asks: the application, the stack, the renderer adapter, react-dom.
  const require = createRequire(path.join(app, 'package.json'));
  const resolveFrom = (from: string, name: string): string =>
    real(createRequire(path.join(from, 'package.json')).resolve(name));
  const applicationReact = real(require.resolve('react'));
  const applicationDom = real(require.resolve('react-dom'));
  const askers: Record<string, string> = {
    stack,
    '@saga-a2ui/react': beneathStack('@saga-a2ui/react'),
    'react-dom': path.dirname(real(require.resolve('react-dom/package.json'))),
  };
  for (const [who, from] of Object.entries(askers)) {
    if (resolveFrom(from, 'react') !== applicationReact)
      fail(`${who} resolves a different react than the application`);
    if (
      who !== 'react-dom' &&
      resolveFrom(from, 'react-dom') !== applicationDom
    )
      fail(`${who} resolves a different react-dom than the application`);
  }
  const runtimes = tree.get('react') ?? new Set<string>();
  if (runtimes.size !== 1)
    fail(`expected one React runtime in the tree, found ${runtimes.size}`);
  const reactDirectories = fs
    .readdirSync(path.join(app, 'node_modules', '.pnpm'))
    .filter((entry) => /^react@/.test(entry));
  if (reactDirectories.length !== 1)
    fail(
      `expected one react@ directory in the store, found ${reactDirectories.join(', ')}`,
    );

  // 3. The stack's stylesheet export resolves from the application, inside the installed stack.
  const stylesheet = real(require.resolve(`${STACK}/faithful-card.css`));
  if (!stylesheet.startsWith(stack))
    fail('the card stylesheet does not resolve inside the installed stack');

  console.log(
    `stack-only footprint: ${STACK_DECLARED.join(', ')} and markdown-it installed beneath the stack; one React runtime (${reactDirectories[0]}).`,
  );
}

const work = createWorkDirectory('saga-react-pnpm-');
try {
  const revision = sourceRevision();
  const packed = packSdkPackages(
    work,
    ['core', 'components', 'mcp', 'react', 'react-mcp-stack'],
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
      ...PEERS,
      zod: '4.6.7',
    },
    overrides: tarballs,
    fixture: 'react-peer-consumer.tsx',
  });
  pnpm(lower, ['install', '--strict-peer-dependencies', '--ignore-scripts']);
  pnpm(lower, ['exec', 'tsc', '--noEmit']);
  console.log(
    'React/MCP pnpm consumer: strict peers and typecheck passed without direct A2UI dependencies.',
  );

  // 2. Stack only: the stack, React, and the upstream packages the application's own catalog is
  // written against. Every other SDK package is reached through the stack.
  const only = path.join(work, 'stack-consumer');
  writeApp(only, {
    dependencies: {
      [STACK]: tarballs[STACK] ?? fail(`${STACK} was not packed`),
      '@a2ui/react': '0.13.0',
      '@a2ui/web_core': '0.13.0',
      // The peer of `@a2ui/react`, which the application's own catalog is written against. It is
      // not the stack's: the stack carries the Zod 4 that `ext-apps` needs, in its own context.
      zod: '3.25.76',
      ...PEERS,
    },
    overrides: tarballs,
    fixture: 'react-stack-consumer.tsx',
  });
  pnpm(only, ['install', '--strict-peer-dependencies', '--ignore-scripts']);
  pnpm(only, ['exec', 'tsc', '--noEmit']);
  assertStackOnlyFootprint(only);
  console.log(
    'React stack pnpm consumer: strict peers, typecheck, installed footprint and single React passed from the stack and React peers alone.',
  );
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
