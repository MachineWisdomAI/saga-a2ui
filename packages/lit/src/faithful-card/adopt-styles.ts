// How an application's own styles reach a Lit card. The card lives inside shadow roots that the
// catalog and the A2UI surface create, and a page's or an element's stylesheet cannot select into
// them, so a rule such as `.saga-card p` would never match. The view therefore carries the
// application's constructable stylesheets, and each card adopts them into the root it is in for as
// long as it is connected. Custom properties inherit through shadow roots and need none of this.

/** The part of a document or shadow root that style adoption uses. */
export interface StyleRoot {
  adoptedStyleSheets: CSSStyleSheet[];
}

const holders = new WeakMap<object, Map<CSSStyleSheet, number>>();

/**
 * Adds `sheets` to `root`, after the sheets it already has, and returns the function that gives
 * them back. A sheet several cards share stays until the last of them lets go; the returned
 * function acts once. A root that cannot adopt styles is left alone.
 */
export function adoptStyles(
  root: StyleRoot,
  sheets: readonly CSSStyleSheet[],
): () => void {
  if (!Array.isArray(root.adoptedStyleSheets) || sheets.length === 0)
    return () => undefined;
  const counts = holders.get(root) ?? new Map<CSSStyleSheet, number>();
  holders.set(root, counts);
  for (const sheet of sheets) {
    counts.set(sheet, (counts.get(sheet) ?? 0) + 1);
    if (!root.adoptedStyleSheets.includes(sheet))
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const sheet of sheets) {
      const left = (counts.get(sheet) ?? 1) - 1;
      if (left > 0) counts.set(sheet, left);
      else {
        counts.delete(sheet);
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
          (one) => one !== sheet,
        );
      }
    }
  };
}
