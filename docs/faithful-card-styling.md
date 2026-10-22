# Styling the FaithfulCard

A branded application styles the card with ordinary CSS, against the surface this document commits to. Both renderers (`@saga-a2ui/react/faithful-card` and `@saga-a2ui/lit/faithful-card`) emit the same surface, so one stylesheet serves either. Anything not listed here is not contract and may change in any release: the markup a renderer wraps around content, the stylesheet's own selectors, and every `data-testid` or `data-annotation` attribute.

The names live in one list, `FAITHFUL_CARD_STYLING` in `@saga-a2ui/components/faithful-card`, which both renderers' tests read.

## Class names

| Class                     | What it marks                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.saga-card`              | The card's root. It carries the tokens below and is also the alert shown when content is refused           |
| `.saga-card-content`      | The interpreted content, inside the root                                                                   |
| `.saga-card-link`         | A link the host may open: a button, so it can never navigate by itself                                     |
| `.saga-card-link-status`  | The readable answer after a link request, directly after its `.saga-card-link`                             |
| `.saga-card-controls`     | The Strict control row (Reveal source, Show images)                                                        |

Inside `.saga-card-content` an application may select the semantic elements `h3`–`h6` (the page owns the top levels, so a Markdown `#` renders as `h3`), `p`, `ol`, `ul`, `li`, `blockquote`, `pre`, `code` and `table`.

## Custom properties

Set any of these on the card or an ancestor. Each has a neutral fallback; unset properties leave the card inheriting the page.

`--saga-card-font-family`, `--saga-card-font-size`, `--saga-card-line-height`, `--saga-card-reading-width` (default `70ch`), `--saga-card-text-color`, `--saga-card-accent-color` (links and the quote rule), `--saga-card-muted-color` (link hostnames), `--saga-card-border-color` (tables and rules) and `--saga-card-code-background`.

There is no typed bridge from a host's own CSS variables to these properties. An application maps a host's theme onto them itself.

## The closing marker

The final top-level block of the content carries `data-saga-closing="paragraph"` when, and only when, that block is a paragraph, whatever its words:

- a trailing list, quote, table, code block or rule means no marker;
- a paragraph nested in a quote, a list item or a table cell is never marked;
- a card with no blocks, or content the card refused, has none.

The marker is structural. The SDK recognises no attribution: whether a marked paragraph is an attribution, a signature or an ordinary sentence is the application's decision, made from the paragraph's words by the application's own code.

```css
/* Any closing paragraph. */
.saga-card .saga-card-content > p[data-saga-closing='paragraph'] {
  margin-bottom: 4px;
}

/* Only what the application's own classifier recognised as its footer. */
.saga-card .saga-card-content > p[data-saga-closing='paragraph'][data-app-footer] {
  border-top: 1px solid var(--saga-card-border-color);
}
```

Re-run the classifier each time the card shows new content; the marker moves with the content, and a previous answer's paragraph is gone.

## Reaching the card from a stylesheet

- **React** renders into the page's own tree, so a page or component stylesheet applies. Import `@saga-a2ui/react/faithful-card.css` for the SDK's presentation, then add rules after it.
- **Lit** renders the card inside shadow roots that the catalog and the A2UI surface create, so a page stylesheet cannot select into it. Pass constructable stylesheets as `styles` to `createFaithfulCardView`; each connected card adopts them into the root it lives in. Custom properties inherit through shadow roots and need no sheet.

## Qualification

`apps/lit-host/e2e/card-styling.spec.ts` renders a branded stylesheet written against this surface alone (`e2e/card-styling/branded.ts`) in both renderers, mounted through each renderer's `openFaithfulCardSurface`, and asserts computed styles for a paragraph, a list, a link and the closing block. It also covers a trailing list, a paragraph nested in a quote, list item or table cell, and a final paragraph that merely reads like an attribution: it carries the marker and receives no application footer styling, because the fixture's classifier rejects it. A structural scan of the stylesheet, the React templates and the Lit element for the committed names is a small additional check; the rendering is the proof.
