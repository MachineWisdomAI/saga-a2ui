import { html, type TemplateResult } from 'lit';

// How a fragment the content policy blocks (a link, an image reference or raw markup) is shown:
// as an accessible placeholder, or, once the reader reveals it, as its source text. Both are fixed
// templates with text bindings. Nothing here activates a destination, loads an image or builds
// markup from the source, so revealing changes visibility only.

export type BlockedKind = 'link' | 'image' | 'markup';

export interface BlockedFragment {
  readonly kind: BlockedKind;
  /** Stable hook for tests and styling: `md-link-inert`, `md-image-blocked` or `md-markup`. */
  readonly testId: string;
  /** Why the policy blocked it (a decision reason, or `load-failed`). */
  readonly reason: string;
  readonly revealed: boolean;
  /** Readable text that stands in for the fragment, for example `[Image blocked: chart]`. */
  readonly placeholder: string;
  /** The source form shown when revealed. It may wrap the fragment's own label. */
  readonly source: (label: TemplateResult | undefined) => TemplateResult;
  /** Ordinary text that belongs to the fragment, such as a link's label, kept in place either way. */
  readonly label?: TemplateResult;
  /** A block-level fragment occupies its own paragraph; an inline one stays in its line. */
  readonly block?: boolean;
}

/** An inline or block placeholder, or the revealed source, in the fragment's original position. */
export function blockedFragment(fragment: BlockedFragment): TemplateResult {
  const { kind, testId, reason, revealed, placeholder, source, label, block } = fragment;
  const presentation = revealed ? 'source' : 'placeholder';
  const standIn = label === undefined ? html`${placeholder}` : html`${label} ${placeholder}`;
  const content = revealed ? source(label) : standIn;
  return block === true
    ? html`<p class="source-block" data-testid=${testId} data-kind=${kind} data-reason=${reason} data-presentation=${presentation}>${content}</p>`
    : html`<span data-testid=${testId} data-kind=${kind} data-reason=${reason} data-presentation=${presentation}>${content}</span>`;
}
