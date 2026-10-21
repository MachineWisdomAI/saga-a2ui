// @vitest-environment jsdom
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The exact runtime the lifecycle tests ran against. Every identity is asserted, not just printed,
// so a dependency change fails here before a behavior claim can quietly stop being true.

const here = createRequire(import.meta.url);

/** The package directory that owns the module `specifier` resolves to, seen from `from`. */
function packageOf(
  specifier: string,
  from: NodeJS.Require = here,
): { dir: string; manifest: { name: string; version: string } } {
  let dir = path.dirname(from.resolve(specifier));
  while (
    !fs.existsSync(path.join(dir, 'package.json')) ||
    !JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name
  ) {
    dir = path.dirname(dir);
  }
  return {
    dir,
    manifest: JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    ),
  };
}

const requireFrom = (dir: string): NodeJS.Require =>
  createRequire(path.join(dir, 'package.json'));

describe('runtime identity of the React action qualification', () => {
  const upstream = packageOf('@a2ui/react/v0_9');
  const webCore = packageOf('@a2ui/web_core/v0_9');

  it('uses the published @a2ui/react 0.13.0 with React and React DOM 19.3.1', () => {
    expect(upstream.manifest).toMatchObject({
      name: '@a2ui/react',
      version: '0.13.0',
    });
    expect(packageOf('react').manifest.version).toBe('19.3.1');
    expect(packageOf('react-dom/client').manifest.version).toBe('19.3.1');
    // 28.1.0 is the newest jsdom whose engines accept the repository's pinned Node 22.12.0; 29 and 30 do not.
    expect(packageOf('jsdom').manifest.version).toBe('28.1.0');
  });

  it('shares one @a2ui/web_core 0.13.0 copy between the renderer, core and this package, so surface and node values mean one thing', () => {
    expect(webCore.manifest).toMatchObject({
      name: '@a2ui/web_core',
      version: '0.13.0',
    });
    const copies = new Set([
      webCore.dir,
      packageOf('@a2ui/web_core/v0_9', requireFrom(upstream.dir)).dir,
      packageOf(
        '@a2ui/web_core/v0_9',
        requireFrom(packageOf('@saga-a2ui/core/actions').dir),
      ).dir,
    ]);
    expect([...copies].map((dir) => fs.realpathSync(dir))).toHaveLength(1);
  });

  it('runs on the pinned Node major and a DOM from jsdom, not a browser', () => {
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(
      22,
    );
    expect(navigator.userAgent).toContain('jsdom');
    // React's development build is what runs, so Strict Mode's extra setup and cleanup are real.
    expect(process.env.NODE_ENV).not.toBe('production');
  });
});
