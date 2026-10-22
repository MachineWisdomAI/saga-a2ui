/// <reference types="node" />
// The direction check reads package sources from disk, so this test (and only this test) needs Node's
// types; the package's own sources keep the DOM-only configuration.
import { describe, expect, it } from 'vitest';
import {
  checkPackageDirection,
  directionViolations,
  readPackage,
} from '../../../scripts/package-direction.js';

describe('dependency direction', () => {
  it('imports core and components only: no delivery, other renderer or stack', () => {
    const { files, violations } = checkPackageDirection('lit');
    // The source was really read.
    expect(files).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });

  it.each([
    [
      "import { runToolResultView } from '@saga-a2ui/mcp/view';",
      'a delivery package',
    ],
    ["import { createElement } from 'react';", 'the other renderer'],
    [
      "import { startA2uiView } from '@saga-a2ui/lit-mcp-stack';",
      'a stack package',
    ],
  ])(
    'fails for a deliberate wrong-direction change: %s (%s)',
    (line, _what) => {
      const { manifest, files } = readPackage('lit');
      const mutant = { path: 'src/mutant.ts', text: `${line}\n` };
      const found = directionViolations('lit', manifest, [...files, mutant]);
      expect(found.map((one) => one.where)).toEqual(['src/mutant.ts']);
    },
  );

  it('fails for a wrong-direction dependency declared in the manifest', () => {
    const { manifest, files } = readPackage('lit');
    const wrong = 'react';
    const found = directionViolations(
      'lit',
      { ...manifest, dependencies: { ...manifest.dependencies, [wrong]: '*' } },
      files,
    );
    expect(found.map((one) => one.where)).toEqual([
      'package.json dependencies',
    ]);
  });
});
