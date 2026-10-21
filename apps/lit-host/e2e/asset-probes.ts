import type { Frame } from '@playwright/test';
import { PROBE_ADVANCE_EM, pngBytes, woff2Bytes } from './asset-fixtures.js';

// Probes for the trusted-resource specs: what the browser really did when a document tried to load an
// image or a font from a data URL, an object URL or an address. Every claim is made from an observed
// natural size, a measured font advance, a security-policy violation or a request, never from source text.

/** One "A" at 16px in the probe font: twice the em, a width no fallback face gives a letter A. */
export const PROBE_WIDTH = PROBE_ADVANCE_EM * 16;

export interface Outcome {
  readonly loaded: boolean;
  /** The image's natural width, or the font's measured advance of one "A" in px. */
  readonly size: number;
  /** The effective directive of each security-policy violation the attempt raised. */
  readonly violations: readonly string[];
}

export const settle = (frame: Frame) =>
  frame.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 150)),
  );

/** Loads an image from the trusted template: a data URL, an object URL, or an address. */
export function probeImage(
  frame: Frame,
  source: 'data' | 'blob' | { readonly url: string },
): Promise<Outcome> {
  return frame.evaluate(
    async ({ source: wanted, png }) => {
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        violations.push(event.effectiveDirective),
      );
      const bytes = Uint8Array.from(atob(png), (character) =>
        character.charCodeAt(0),
      );
      const url =
        wanted === 'data'
          ? `data:image/png;base64,${png}`
          : wanted === 'blob'
            ? URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
            : wanted.url;
      const image = document.createElement('img');
      const loaded = await new Promise<boolean>((resolve) => {
        image.addEventListener('load', () => resolve(true));
        image.addEventListener('error', () => resolve(false));
        image.src = url;
        document.body.append(image);
      });
      await new Promise((resolve) => setTimeout(resolve, 150)); // a violation event may follow the error
      return { loaded, size: image.naturalWidth, violations };
    },
    { source, png: pngBytes().toString('base64') },
  );
}

/**
 * Loads the probe font from a data URL, an object URL or an address, through the FontFace API or
 * an `@font-face` rule, then measures one "A" set in it with a fallback behind. Loaded means the
 * browser fetched and used the font (the measured advance is the probe's); a failure leaves the
 * fallback, whose advance is something else and whose text stays readable.
 */
export function probeFont(
  frame: Frame,
  source: 'data' | 'blob' | { readonly url: string },
  via: 'api' | 'css' = 'api',
): Promise<Outcome & { readonly readable: boolean }> {
  return frame.evaluate(
    async ({ source: wanted, font, via: route, family }) => {
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        violations.push(event.effectiveDirective),
      );
      const bytes = Uint8Array.from(atob(font), (character) =>
        character.charCodeAt(0),
      );
      const url =
        wanted === 'data'
          ? `data:font/woff2;base64,${font}`
          : wanted === 'blob'
            ? URL.createObjectURL(new Blob([bytes], { type: 'font/woff2' }))
            : wanted.url;
      let loaded = false;
      if (route === 'api') {
        const face = new FontFace(family, `url("${url}")`);
        try {
          await face.load();
          document.fonts.add(face);
          loaded = true;
        } catch {
          loaded = false;
        }
      } else {
        const style = document.createElement('style');
        style.textContent = `@font-face{font-family:"${family}";src:url("${url}")}`;
        document.head.append(style);
        loaded =
          (await document.fonts.load(`16px "${family}"`, 'A').catch(() => []))
            .length > 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      const text = document.createElement('span');
      text.textContent = 'A';
      text.style.cssText = `position:absolute;left:0;top:0;white-space:pre;font:16px "${family}", monospace`;
      document.body.append(text);
      const box = text.getBoundingClientRect();
      return {
        loaded,
        size: box.width,
        violations,
        readable: box.width > 0 && box.height > 0,
      };
    },
    {
      source,
      font: woff2Bytes().toString('base64'),
      via,
      family: `F${Math.random().toString(36).slice(2)}`,
    },
  );
}
export const policyText = (frame: Frame): Promise<string[]> =>
  frame.evaluate(() =>
    Array.from(
      document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]'),
      (meta) => meta.getAttribute('content') ?? '',
    ),
  );

export function directive(policy: string, name: string): string[] {
  return policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part === name || part.startsWith(`${name} `));
}
