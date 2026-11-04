import { describe, expect, it } from 'vitest';
import { adoptStyles, type StyleRoot } from './adopt-styles.js';

// Application styles reach a card through the root the card lives in. The logic is checked on a
// stand-in root; adoption by a real shadow root is observed in the browser.

const sheet = (name: string): CSSStyleSheet => ({ name }) as never;
const root = (...initial: CSSStyleSheet[]): StyleRoot => ({
  adoptedStyleSheets: initial,
});

describe('adopting application styles into the root a card lives in', () => {
  it('adds the sheets after the root’s own and removes exactly them when released', () => {
    const own = sheet('own');
    const brand = sheet('brand');
    const target = root(own);
    const release = adoptStyles(target, [brand]);
    expect(target.adoptedStyleSheets).toEqual([own, brand]);
    release();
    expect(target.adoptedStyleSheets).toEqual([own]);
  });

  it('keeps a shared sheet until the last card using it lets go', () => {
    const brand = sheet('brand');
    const target = root();
    const first = adoptStyles(target, [brand]);
    const second = adoptStyles(target, [brand]);
    expect(target.adoptedStyleSheets).toEqual([brand]);
    first();
    expect(target.adoptedStyleSheets).toEqual([brand]);
    second();
    expect(target.adoptedStyleSheets).toEqual([]);
  });

  it('releases only once, however often it is called', () => {
    const brand = sheet('brand');
    const target = root();
    const first = adoptStyles(target, [brand]);
    adoptStyles(target, [brand]);
    first();
    first();
    expect(target.adoptedStyleSheets).toEqual([brand]);
  });

  it('never removes a sheet the root already had before the card adopted it', () => {
    const brand = sheet('brand');
    const target = root(brand);
    const first = adoptStyles(target, [brand]);
    const second = adoptStyles(target, [brand]);
    first();
    second();
    expect(target.adoptedStyleSheets).toEqual([brand]);
  });

  it('keeps a preexisting sheet even when a card that inserted nothing is the last to let go, and removes one it inserted only after every holder', () => {
    const owned = sheet('owned');
    const added = sheet('added');
    const target = root(owned);
    const first = adoptStyles(target, [owned, added]);
    const second = adoptStyles(target, [added]);
    first();
    expect(target.adoptedStyleSheets).toEqual([owned, added]);
    second();
    expect(target.adoptedStyleSheets).toEqual([owned]);
  });

  it('does nothing for a root that cannot adopt styles', () => {
    const release = adoptStyles({} as never, [sheet('brand')]);
    expect(() => release()).not.toThrow();
  });
});
