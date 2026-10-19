// @vitest-environment jsdom
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { version as reactVersion } from 'react';
import { version as reactDomVersion } from 'react-dom';
import { describe, expect, it } from 'vitest';

// The versions this package supports are the ones its tests actually ran against. Every real
// rendering suite in this package (the card, the action control, A2UI replacement, data updates,
// disposal, stale controls, several cards, Strict Mode) runs on the installed copies read here, so
// the declared pins and the installed copies must be one and the same: a manifest that names a
// version nothing ran on, or an install that drifted from the manifest, fails here.

const readJson = (relative: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const installed = (name: string): string => readJson(`../../../node_modules/${name}/package.json`).version;
const manifest = readJson('../package.json');
const consumer = readJson('../../../apps/lit-host/package.json');

describe('the supported React and upstream A2UI versions', () => {
  it('pin React and React DOM to the single version the tests ran on', () => {
    expect(installed('react')).toBe('19.3.1');
    expect(installed('react-dom')).toBe('19.3.1');
    expect(reactVersion).toBe(installed('react'));
    expect(reactDomVersion).toBe(installed('react-dom'));
    // Peers and development copies name exactly that version, not a range nobody ran.
    expect(manifest.peerDependencies.react).toBe('19.3.1');
    expect(manifest.peerDependencies['react-dom']).toBe('19.3.1');
    expect(manifest.devDependencies.react).toBe('19.3.1');
    expect(manifest.devDependencies['react-dom']).toBe('19.3.1');
    expect(installed('@types/react')).toBe(manifest.devDependencies['@types/react']);
    expect(installed('@types/react-dom')).toBe(manifest.devDependencies['@types/react-dom']);
  });

  it('pin the upstream A2UI packages exactly to the installed copies', () => {
    for (const name of ['@a2ui/react', '@a2ui/web_core']) {
      expect(manifest.dependencies[name], name).toBe('0.13.0');
      expect(installed(name), name).toBe('0.13.0');
    }
    // The renderer upstream declares broader React peers than this package supports; ours are the narrower, qualified ones.
    const upstream = readJson('../../../node_modules/@a2ui/react/package.json');
    expect(upstream.peerDependencies.react).toContain('^19.0.0');
    expect(upstream.peerDependencies['react-dom']).toContain('^19.0.0');
  });

  it('are the versions the application consuming the package builds with, so no renderer was upgraded silently', () => {
    expect(consumer.dependencies.react).toBe('19.3.1');
    expect(consumer.dependencies['react-dom']).toBe('19.3.1');
    expect(consumer.dependencies['@a2ui/react']).toBe('0.13.0');
    expect(consumer.dependencies['@a2ui/web_core']).toBe('0.13.0');
    // The Lit renderer is a separate package with its own pin, and was not touched.
    expect(consumer.dependencies['@a2ui/lit']).toBe('0.13.0');
  });
});
