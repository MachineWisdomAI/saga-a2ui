// How an application's own styles reach a Lit card. The card lives inside shadow roots that the
// catalog and the A2UI surface create, and a page's or an element's stylesheet cannot select into
// them, so a rule such as `.saga-card p` would never match. The view therefore carries the
// application's constructable stylesheets, and each card adopts them into the root it is in for as
// long as it is connected. Custom properties inherit through shadow roots and need none of this.

/** The part of a document or shadow root that style adoption uses. */
export interface StyleRoot {
  adoptedStyleSheets: CSSStyleSheet[];
}

/** Per sheet in a root: how many cards hold it, and whether adoption (not the root's owner) put it there. */
interface Holding {
  count: number;
  readonly inserted: boolean;
}

const holders = new WeakMap<object, Map<CSSStyleSheet, Holding>>();

/**
 * Adds `sheets` to `root`, after the sheets it already has, and returns the function that gives
 * them back. A sheet several cards share stays until the last of them lets go. Only a sheet that
 * adoption itself inserted is ever removed: one the root already had is its owner's and stays,
 * whoever adopts it too. The returned function acts once. A root that cannot adopt styles is left
 * alone.
 */
export function adoptStyles(
  root: StyleRoot,
  sheets: readonly CSSStyleSheet[],
): () => void {
  if (!Array.isArray(root.adoptedStyleSheets) || sheets.length === 0)
    return () => undefined;
  const holdings = holders.get(root) ?? new Map<CSSStyleSheet, Holding>();
  holders.set(root, holdings);
  for (const sheet of sheets) {
    const held = holdings.get(sheet);
    if (held !== undefined) {
      held.count += 1;
      continue;
    }
    const inserted = !root.adoptedStyleSheets.includes(sheet);
    if (inserted) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    holdings.set(sheet, { count: 1, inserted });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const sheet of sheets) {
      const held = holdings.get(sheet);
      if (held === undefined) continue;
      held.count -= 1;
      if (held.count > 0) continue;
      holdings.delete(sheet);
      if (held.inserted)
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
          (one) => one !== sheet,
        );
    }
  };
}
