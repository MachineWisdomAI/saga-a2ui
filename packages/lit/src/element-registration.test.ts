import { describe, expect, it } from 'vitest';
import {
  defineElements,
  ElementConflictError,
  type ElementRegistry,
} from './element-registration.js';

// The registry is the external seam: a map stands in for `CustomElementRegistry`, which the
// browser tests exercise for real. These cases pin the rule for two catalogs that share a tag.

class FirstPanel {}
class OtherPanel {}
class Card {}
const as = (constructor: new () => object) =>
  constructor as unknown as CustomElementConstructor;

function newRegistry(): ElementRegistry & {
  readonly defined: ReadonlyMap<string, CustomElementConstructor>;
} {
  const defined = new Map<string, CustomElementConstructor>();
  return {
    defined,
    get: (tagName) => defined.get(tagName),
    define: (tagName, element) => void defined.set(tagName, element),
  };
}

describe('defineElements', () => {
  it('defines every element it is given', () => {
    const registry = newRegistry();
    defineElements(
      [
        { tagName: 'app-panel', element: as(FirstPanel) },
        { tagName: 'app-card', element: as(Card) },
      ],
      registry,
    );
    expect([...registry.defined]).toEqual([
      ['app-panel', FirstPanel],
      ['app-card', Card],
    ]);
  });

  it('is harmless to repeat, and when two catalogs share a tag with the same constructor', () => {
    const registry = newRegistry();
    const panel = { tagName: 'app-panel', element: as(FirstPanel) };
    defineElements([panel], registry);
    expect(() => defineElements([panel], registry)).not.toThrow();
    expect(() => defineElements([panel, { ...panel }], registry)).not.toThrow();
    expect(registry.defined.get('app-panel')).toBe(FirstPanel);
  });

  it('fails explicitly for a different constructor on the same tag and keeps the first definition', () => {
    const registry = newRegistry();
    defineElements(
      [{ tagName: 'app-panel', element: as(FirstPanel) }],
      registry,
    );

    const attempt = () =>
      defineElements(
        [{ tagName: 'app-panel', element: as(OtherPanel) }],
        registry,
      );
    expect(attempt).toThrow(ElementConflictError);
    expect(attempt).toThrow(/<app-panel>/);
    expect(registry.defined.get('app-panel')).toBe(FirstPanel);
  });

  it('adds nothing from a call that fails, even for tags listed before the conflict', () => {
    const registry = newRegistry();
    defineElements(
      [{ tagName: 'app-panel', element: as(FirstPanel) }],
      registry,
    );

    expect(() =>
      defineElements(
        [
          { tagName: 'app-card', element: as(Card) },
          { tagName: 'app-panel', element: as(OtherPanel) },
        ],
        registry,
      ),
    ).toThrow(ElementConflictError);
    expect([...registry.defined.keys()]).toEqual(['app-panel']);
  });

  it('rejects two different constructors for one tag within a single call', () => {
    const registry = newRegistry();
    expect(() =>
      defineElements(
        [
          { tagName: 'app-panel', element: as(FirstPanel) },
          { tagName: 'app-panel', element: as(OtherPanel) },
        ],
        registry,
      ),
    ).toThrow(ElementConflictError);
    expect(registry.defined.size).toBe(0);
  });
});
