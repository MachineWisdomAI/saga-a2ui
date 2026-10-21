// Custom-element registration for an application's catalog. This module deliberately imports no
// renderer, so the rule can be exercised without a DOM.

/** One custom element an application needs: a catalog component's `LitComponentApi` fits as is. */
export interface ElementDefinition {
  readonly tagName: string;
  readonly element: CustomElementConstructor;
}

/** The part of `CustomElementRegistry` that registration uses. */
export interface ElementRegistry {
  get(tagName: string): CustomElementConstructor | undefined;
  define(tagName: string, element: CustomElementConstructor): void;
}

/** A tag is already bound to a different constructor, so using it would render the wrong component. */
export class ElementConflictError extends Error {
  constructor(readonly tagName: string) {
    super(
      `The custom element <${tagName}> is already defined with a different constructor. ` +
        'Give each implementation its own tag name.',
    );
    this.name = 'ElementConflictError';
  }
}

/**
 * Defines each element in the registry. Setup is explicit: importing this package registers nothing.
 *
 * - A tag that is not defined yet is defined.
 * - A tag already bound to the very same constructor is left alone, so repeating setup is harmless.
 * - A tag bound to a different constructor fails with `ElementConflictError`. The existing
 *   definition is never replaced, and no definition from the failing call is added: every tag is
 *   checked before the first one is defined.
 */
export function defineElements(
  definitions: readonly ElementDefinition[],
  registry: ElementRegistry = customElements,
): void {
  const missing = new Map<string, CustomElementConstructor>();
  for (const { tagName, element } of definitions) {
    const existing = registry.get(tagName) ?? missing.get(tagName);
    if (existing !== undefined && existing !== element)
      throw new ElementConflictError(tagName);
    if (existing === undefined) missing.set(tagName, element);
  }
  for (const [tagName, element] of missing) registry.define(tagName, element);
}
