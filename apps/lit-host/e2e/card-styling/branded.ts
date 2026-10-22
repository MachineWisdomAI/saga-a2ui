// Test-only. A branded application's styling of the FaithfulCard, written against the committed
// styling surface alone (docs/faithful-card-styling.md): class names, semantic elements, the nine
// tokens and the closing marker. It is a synthetic rewrite of a real application's card theme: the
// same kinds of rule (reading rhythm, a numbered list with a generated marker, link treatment and a
// footer for the closing paragraph), none of its artwork, and no selector reaching into markup the
// SDK does not commit to. Both renderers' pages load exactly this text.

export const BRANDED_CSS = `
.saga-card {
  --saga-card-font-family: Georgia, 'Times New Roman', serif;
  --saga-card-font-size: 18px;
  --saga-card-line-height: 1.5;
  --saga-card-reading-width: 100%;
  --saga-card-text-color: rgb(23, 34, 53);
  --saga-card-accent-color: rgb(21, 88, 62);
  --saga-card-muted-color: rgb(85, 98, 117);
  --saga-card-border-color: rgb(195, 206, 210);
  --saga-card-code-background: rgb(238, 242, 243);
  padding: 12px 34px 24px;
  background: rgb(255, 255, 255);
}

.saga-card p {
  margin: 0 0 22px;
}

.saga-card :is(h3, h4, h5, h6) {
  margin: 22px 0 12px;
  font-size: 20px;
  line-height: 1.35;
}

.saga-card :is(ul, ol) {
  margin: 18px 0 24px;
}

.saga-card ul {
  padding-inline-start: 24px;
}

.saga-card ul > li {
  margin: 12px 0;
  padding-inline-start: 4px;
}

.saga-card blockquote {
  margin: 20px 0;
  padding-inline-start: 18px;
  border-inline-start: 2px solid rgb(195, 206, 210);
}

.saga-card pre {
  white-space: pre-wrap;
}

.saga-card code {
  font-size: 0.9em;
}

.saga-card .saga-card-link {
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
}

/* A numbered list keeps its list semantics; a disk generated from the browser's own counter replaces the marker. */
.saga-card ol {
  padding: 0;
  margin-block: 27px 30px;
}

.saga-card ol > li {
  position: relative;
  min-height: 64px;
  padding-inline-start: 82px;
}

.saga-card ol > li::marker {
  content: '';
}

.saga-card ol > li::before {
  content: counter(list-item);
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgb(21, 88, 62);
  color: rgb(255, 255, 255);
  font-weight: 700;
}

/* The closing block, wherever the content ends in a paragraph: structural, whatever its words. */
.saga-card .saga-card-content > p[data-saga-closing='paragraph'] {
  margin-bottom: 4px;
}

/* The application's footer: only a closing paragraph that the application itself has recognised. */
.saga-card .saga-card-content > p[data-saga-closing='paragraph'][data-app-attribution] {
  margin-top: 23px;
  padding-block-start: 17px;
  border-top: 1px solid rgb(195, 206, 210);
  color: rgb(85, 98, 117);
  font-size: 14px;
  line-height: 1.5;
}
`;

/** The one sentence this application treats as its attribution. The SDK knows nothing of it. */
export const ATTRIBUTION_SENTENCE = 'This information came from ansari.chat.';

/**
 * The application's own decision: of the paragraphs the card marked as closing, which is the
 * attribution. It reads the marked paragraph's words and sets the application's own attribute; the
 * card never does either. The walk goes through the open shadow roots a Lit card sits in, since the
 * application's code must find the paragraph wherever the renderer put it.
 */
export function classifyAttribution(root: ParentNode): number {
  let found = 0;
  const visit = (node: ParentNode): void => {
    for (const paragraph of node.querySelectorAll(
      '[data-saga-closing="paragraph"]',
    )) {
      if ((paragraph.textContent ?? '').trim() === ATTRIBUTION_SENTENCE) {
        paragraph.setAttribute('data-app-attribution', '');
        found += 1;
      } else paragraph.removeAttribute('data-app-attribution');
    }
    for (const element of node.querySelectorAll('*'))
      if (element.shadowRoot) visit(element.shadowRoot);
  };
  visit(root);
  return found;
}

export interface CardPage {
  /** Presents `markdown` through the renderer's card surface and runs the application's classifier. */
  present(markdown: string): Promise<void>;
}

declare global {
  interface Window {
    cardPage?: CardPage;
  }
}
