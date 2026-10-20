import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  createWorkDirectory, packSdkPackages, repoRoot, candidateVersion, sourceRevision,
} from './packed-consumer.js';

// Linking workspace node_modules cannot detect incorrect pnpm peer contexts.
const work = createWorkDirectory('saga-react-pnpm-');
try {
  const revision = sourceRevision();
  const packed = packSdkPackages(
    work, ['core', 'components', 'mcp', 'react'], path.join(work, 'tarballs'),
    candidateVersion(revision.commit, revision.dirty),
  );
  const app = path.join(work, 'consumer');
  fs.mkdirSync(app);
  const dependencies = Object.fromEntries(
    packed.map(p => [`@saga-a2ui/${p.name}`, `file:${p.tarball}`]),
  );
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    packageManager: 'pnpm@10.33.0',
    dependencies: {
      ...dependencies,
      '@modelcontextprotocol/ext-apps': '2.0.3',
      react: '19.3.1',
      'react-dom': '19.3.1',
      zod: '4.6.7',
    },
    devDependencies: {
      typescript: '5.9.3',
      '@types/node': '22.20.5',
      '@types/react': '19.3.0',
      '@types/react-dom': '19.3.0',
    },
  }));
  // Sibling overrides resolve unpublished tarballs only. Markdown is the documented consumer setting.
  fs.writeFileSync(path.join(app, 'pnpm-workspace.yaml'), 'packages: []\noverrides:\n' +
    Object.entries(dependencies).map(([name, file]) => `  "${name}": "${file}"\n`).join('') +
    '  "@a2ui/markdown-it": "0.2.1"\n');
  fs.copyFileSync(
    path.join(repoRoot, 'scripts/fixtures/react-peer-consumer.tsx'),
    path.join(app, 'consumer.tsx'),
  );
  fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false,
    },
    include: ['consumer.tsx'],
  }));
  const run = (args: string[]) => execFileSync('pnpm', args, {cwd: app, stdio: 'inherit'});
  run(['install', '--strict-peer-dependencies', '--ignore-scripts']);
  run(['exec', 'tsc', '--noEmit']);
  console.log('React/MCP pnpm consumer: strict peers and typecheck passed without direct A2UI dependencies.');
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}
