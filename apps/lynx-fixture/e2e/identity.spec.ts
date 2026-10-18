import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { builtBundle, readTemplate } from './bundle.js';
import { Fixture } from './fixture.js';

// What actually ran. A qualification applies only to this target: the Lynx Web runtime in
// Chromium. Nothing here is evidence for a native Lynx runtime, the Lynx Explorer, or any host.

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

/** The installed manifest of `name`, found the way Node's resolution walks `node_modules` from `from`. */
function installed(name: string, from = appRoot): { version: string; license: string; dir: string } {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) {
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version: string; license?: string };
      return { version: manifest.version, license: manifest.license ?? 'unknown', dir: path.dirname(candidate) };
    }
    if (path.dirname(dir) === dir) throw new Error(`${name} is not installed above ${from}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const PINNED = {
  '@lynx-js/genui': '0.7.0',
  '@lynx-js/react': '0.128.0',
  '@lynx-js/lynx-ui': '3.140.0',
  '@lynx-js/react-rsbuild-plugin': '0.21.0',
  '@lynx-js/rspeedy': '0.18.2',
  '@lynx-js/types': '4.3.0',
  '@lynx-js/web-core': '0.26.4',
} as const;

test.describe('selected runtime and target', () => {
  test('the renderer, compiler and runtime versions are pinned exactly and are the installed ones', () => {
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [name, version] of Object.entries(PINNED)) {
      expect(declared[name], `${name} is declared exactly`).toBe(version);
      expect(installed(name).version, `${name} is installed as declared`).toBe(version);
    }
  });

  test('GenUI interprets the protocol with its own @a2ui/web_core 0.10.6, beside the 0.13.0 SAGA core uses', () => {
    const nested = installed('@a2ui/web_core', installed('@lynx-js/genui').dir);
    const root = installed('@a2ui/web_core', path.resolve(appRoot, '..', '..', 'packages', 'core'));
    expect(nested.version).toBe('0.10.6');
    expect(root.version).toBe('0.13.0');
    expect(nested.version).not.toBe(root.version);
  });

  test('the bundle is a Web template for the React (ReactLynx) card type and the page runs it on the Web runtime in Chromium', async ({ page, browser }) => {
    const template = readTemplate(builtBundle);
    expect(template.configuration['cardType']).toBe('react');

    const fixture = await Fixture.open(page);
    const facts = await fixture.send<{ systemInfo: Record<string, unknown> | null; typeofDocument: string; selfIsWorker: boolean }>('runtime-facts');
    expect(facts.systemInfo).toMatchObject({ platform: 'web' });
    // The background thread is a Web Worker: not a native JS engine, not the Explorer.
    expect(facts).toMatchObject({ typeofDocument: 'undefined', selfIsWorker: true });

    const report = {
      target: 'Lynx Web runtime, Chromium',
      chromium: browser.version(),
      node: process.version,
      systemInfo: facts.systemInfo,
      versions: Object.fromEntries(Object.keys(PINNED).map((name) => [name, installed(name).version])),
      licenses: Object.fromEntries(Object.keys(PINNED).map((name) => [name, installed(name).license])), // @lynx-js/react declares none in its manifest; its LICENSE file is Apache-2.0
      genuiWebCore: installed('@a2ui/web_core', installed('@lynx-js/genui').dir).version,
      sagaCoreWebCore: '0.13.0',
      typescript: installed('typescript').version,
    };
    console.log(`QUALIFIED TARGET ${JSON.stringify(report)}`);
  });
});
