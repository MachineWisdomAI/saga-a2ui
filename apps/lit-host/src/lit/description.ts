import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { LinkOpenOutcome } from '../content/host-links.js';
import type { ImageConsent } from '../content/image-consent.js';
import {
  fragmentsOf,
  parseDescription,
  type BlockNode,
  type DescriptionFragments,
  type InlineNode,
  type ParsedDescription,
  type ParseFailure,
} from '../content/markdown.js';
import type { ImageContext } from '../content/policy.js';
import { blockedFragment } from './blocked-fragment.js';
import { requestContentView, type ContentView } from './content-view.js';

// Renders a description. The Markdown module has already reduced the text to a closed set of
// nodes; every case below is a fixed template with text bindings. Nothing here builds markup from
// text (no unsafeHTML, innerHTML or equivalent), and a link or image is used only when the
// view's trusted content policy permits it.
//
// Under Strict the element also owns two reader controls. Reveal/Hide source changes visibility
// only. Show/Hide images grants or revokes consent for this description in this view; the grant
// is bound to the element, so a content change, a view-wide revocation, Hide images and
// disconnection each retire it, and nothing holding the old grant can bring images back.

const LINK_FEEDBACK: Record<LinkOpenOutcome, string> = {
  opened: 'The host was asked to open this link.',
  denied: 'The host did not open this link.',
  unavailable: 'This host cannot open links.',
  failed: 'The link could not be opened.',
};

/** A supplied string, read once: the restricted nodes and what they reference, or why it was refused. */
type Interpretation = { readonly source: string } & (
  | { readonly ok: true; readonly description: ParsedDescription; readonly fragments: DescriptionFragments }
  | { readonly ok: false; readonly failure: ParseFailure }
);

/** What one render pass needs; assembled once so the node templates stay small. */
interface Rendering {
  readonly view: ContentView;
  readonly strict: boolean;
  /** Whether blocked fragments are shown as source text rather than placeholders. */
  readonly revealed: boolean;
  readonly images: ImageContext;
  readonly counters: { link: number; image: number };
}

/** Light DOM on purpose: the panel's text stays inside the panel for styling and testing. */
export class SagaDescriptionElement extends LitElement {
  /** The description exactly as supplied. */
  @property({ attribute: false }) source = '';

  @state() private linkOutcomes: ReadonlyMap<number, LinkOpenOutcome> = new Map();
  @state() private failedImages: ReadonlySet<number> = new Set();
  @state() private sourceRevealed = false;
  /** The reader's current consent to load images. Absent until Show images, and after any revocation. */
  @state() private consent?: ImageConsent;
  /** True once the view has retired image consent for good (host teardown). No control can grant after it. */
  @state() private consentEnded = false;

  private view?: ContentView;
  private parsed?: Interpretation;
  private revocationWatch?: { unsubscribe(): void };
  /** Retires link results that arrive after the content changed or the element was removed. */
  private generation = 0;
  /** Retires image load results that arrive after consent ended or the content changed. */
  private imageEpoch = 0;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.view = requestContentView(this);
    this.consentEnded = this.view?.consent.retired === true;
    this.revocationWatch = this.view?.consent.subscribe(() => {
      this.retireImages();
      this.consentEnded = this.view?.consent.retired === true;
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.generation += 1;
    this.revocationWatch?.unsubscribe();
    this.revocationWatch = undefined;
    this.retireImages();
    this.view = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('source')) {
      this.generation += 1;
      this.linkOutcomes = new Map();
      // New content starts from the policy's own presentation and needs fresh consent.
      this.sourceRevealed = this.view?.policy.blockedPresentation === 'inert-text';
      this.retireImages();
    }
  }

  /** Ends the current consent and forgets image results that belong to it. Idempotent. */
  private retireImages(): void {
    this.imageEpoch += 1;
    this.consent?.revoke();
    this.consent = undefined;
    if (this.failedImages.size > 0) this.failedImages = new Set();
  }

  /** Parses the current description once, with the blockable fragments it references. */
  private interpretation(): Interpretation {
    if (this.parsed?.source !== this.source) {
      const result = parseDescription(this.source);
      this.parsed = result.ok
        ? { source: this.source, ok: true, description: result.description, fragments: fragmentsOf(result.description) }
        : { source: this.source, ok: false, failure: result.failure };
    }
    return this.parsed;
  }

  private imageContext(view: ContentView): ImageContext {
    return { enforcement: view.imageEnforcement, consent: this.consent?.live === true ? 'granted' : 'not-granted' };
  }

  protected override render(): TemplateResult {
    const view = this.view;
    // Without a view that supplies a policy, the text is shown exactly as written.
    if (view === undefined) return html`<p data-testid="description-plain">${this.source}</p>`;
    const interpretation = this.interpretation();
    if (!interpretation.ok) {
      const { failure } = interpretation;
      return failure.kind === 'too-long'
        ? html`<p role="alert" data-testid="description-limit">
            This description is too long to display (${failure.length} characters; the limit is
            ${failure.limit}).
          </p>`
        : html`<p role="alert" data-testid="description-limit" data-reason="too-nested">
            This description is nested too deeply to display (the nesting limit is
            ${failure.limit} levels; a quote counts as one and a list item as two).
          </p>`;
    }
    const { description, fragments } = interpretation;
    const rendering: Rendering = {
      view,
      strict: view.policy.level === 'strict',
      revealed: this.sourceRevealed,
      images: this.imageContext(view),
      counters: { link: 0, image: 0 },
    };
    return html`<style>
        saga-description .link-button { font: inherit; color: inherit; background: none; border: 0; padding: 0;
          text-decoration: underline; cursor: pointer; }
        saga-description .link-host { font-size: 0.85em; }
        saga-description img { max-width: 100%; height: auto; }
        saga-description blockquote { margin-inline: 1em; padding-inline-start: 0.75em; border-inline-start: 3px solid #999; }
        saga-description .source-block { white-space: pre-wrap; overflow-wrap: anywhere; }
        saga-description [data-presentation="placeholder"] { font-style: italic; }
        saga-description .content-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em; margin-block: 0.5em; }
      </style>
      ${rendering.strict ? this.controls(view, fragments) : nothing}
      <div data-testid="description-content">${description.blocks.map((block) => this.block(block, rendering))}</div>`;
  }

  /** Strict only. Both buttons keep one template, so focus stays on the control the reader used. */
  private controls(view: ContentView, fragments: DescriptionFragments): TemplateResult {
    const blockable = fragments.links + fragments.images.length + fragments.rawHtml > 0;
    const granted = this.consent?.live === true;
    const offer = view.policy.offerImages(fragments.images, view.imageEnforcement);
    const unavailableReason = !granted && !offer.available ? offer.reason : undefined;
    const ended = !granted && this.consentEnded;
    // The controls belong to the description revision they were rendered for; see `current`.
    const revision = this.generation;
    return html`<div class="content-controls" data-testid="description-controls">
      ${blockable
        ? html`<button type="button" data-testid="source-toggle" @click=${() => (this.sourceRevealed = !this.sourceRevealed)}>
            ${this.sourceRevealed ? 'Hide source' : 'Reveal source'}
          </button>`
        : nothing}
      ${fragments.images.length === 0
        ? nothing
        : html`<button
              type="button"
              data-testid="images-toggle"
              ?disabled=${unavailableReason !== undefined || ended}
              @click=${() => {
                if (!this.current(view, revision)) return;
                if (granted) this.retireImages();
                else this.showImages(view);
              }}
            >
              ${granted ? 'Hide images' : 'Show images'}
            </button>
            <span role="status" data-testid="images-status"
              >${granted ? 'Images shown.' : nothing}</span
            >
            ${ended
              ? html`<span data-testid="images-unavailable" data-reason="view-ended"
                  >Images can no longer be shown: this view has ended.</span
                >`
              : nothing}
            ${unavailableReason === undefined
              ? nothing
              : html`<span data-testid="images-unavailable" data-reason=${unavailableReason}
                  >Images in this description cannot be shown: none is permitted by the content policy or
                  this host.</span
                >`}`}
    </div>`;
  }

  /**
   * Whether a control rendered for `view` at description revision `revision` still belongs to
   * this element's current state. A control the reader (or old code) kept hold of after the
   * description changed, or after the element was disconnected, is stale and must do nothing:
   * consent is for the description the reader was shown, not whatever is current when it fires.
   */
  private current(view: ContentView, revision: number): boolean {
    return this.view === view && this.generation === revision;
  }

  /** Records consent for the current description. Callers have already checked the control is current. */
  private showImages(view: ContentView): void {
    const interpretation = this.interpretation();
    if (this.view !== view || !interpretation.ok) return;
    if (!view.policy.offerImages(interpretation.fragments.images, view.imageEnforcement).available) return;
    this.imageEpoch += 1;
    this.consent?.revoke();
    const grant = view.consent.grant();
    if (grant.live) this.consent = grant; // a retired view hands out only dead grants
  }

  private block(node: BlockNode, r: Rendering): TemplateResult {
    switch (node.kind) {
      case 'paragraph':
        return html`<p>${this.inlines(node.children, r)}</p>`;
      case 'heading': {
        // The panel title is the h2; description headings sit below it.
        const content = this.inlines(node.children, r);
        if (node.level === 1) return html`<h3>${content}</h3>`;
        if (node.level === 2) return html`<h4>${content}</h4>`;
        if (node.level === 3) return html`<h5>${content}</h5>`;
        return html`<h6>${content}</h6>`;
      }
      case 'quote':
        return html`<blockquote>${node.children.map((child) => this.block(child, r))}</blockquote>`;
      case 'list': {
        const items = node.items.map((item) => html`<li>${item.map((child) => this.block(child, r))}</li>`);
        return node.ordered ? html`<ol start=${node.start}>${items}</ol>` : html`<ul>${items}</ul>`;
      }
      case 'code-block':
        return html`<pre><code>${node.text}</code></pre>`;
      case 'raw-html-block':
        return r.strict
          ? blockedFragment({
              kind: 'markup',
              testId: 'md-markup',
              reason: 'raw-html',
              revealed: r.revealed,
              placeholder: '[Markup blocked]',
              source: () => html`${node.text}`,
              block: true,
            })
          : html`<p class="source-block">${node.text}</p>`;
      case 'rule':
        return html`<hr />`;
    }
  }

  private inlines(nodes: readonly InlineNode[], r: Rendering): TemplateResult[] {
    return nodes.map((node) => this.inline(node, r));
  }

  private inline(node: InlineNode, r: Rendering): TemplateResult {
    switch (node.kind) {
      case 'text':
        return html`${node.text}`;
      case 'code':
        return html`<code>${node.text}</code>`;
      case 'emphasis':
        return html`<em>${this.inlines(node.children, r)}</em>`;
      case 'strong':
        return html`<strong>${this.inlines(node.children, r)}</strong>`;
      case 'softbreak':
        return html`${'\n'}`;
      case 'hardbreak':
        return html`<br />`;
      case 'raw-html':
        return r.strict
          ? blockedFragment({
              kind: 'markup',
              testId: 'md-markup',
              reason: 'raw-html',
              revealed: r.revealed,
              placeholder: '[Markup blocked]',
              source: () => html`${node.text}`,
            })
          : html`${node.text}`;
      case 'link':
        return this.link(node, r);
      case 'image':
        return this.image(node, r);
    }
  }

  private link(node: Extract<InlineNode, { kind: 'link' }>, r: Rendering): TemplateResult {
    const ordinal = r.counters.link++;
    const label = this.inlines(node.children, r);
    const decision = r.view.policy.decideLink(node.destination);
    if (!decision.allowed) {
      if (r.strict) {
        // Strict never activates a link, even an otherwise valid one and even after image consent.
        return blockedFragment({
          kind: 'link',
          testId: 'md-link-inert',
          reason: decision.reason,
          revealed: r.revealed,
          placeholder: '[Link blocked]',
          label: html`${label}`,
          source: (text) => html`[${text}](${node.destination})`,
        });
      }
      // Not activatable: the text and its destination are shown, and nothing can be invoked.
      return html`<span data-testid="md-link-inert" data-reason=${decision.reason}
        >${label} <span class="link-destination">(${node.destination})</span></span
      >`;
    }
    const outcome = this.linkOutcomes.get(ordinal);
    // The hostname is inside the button, so it is both visible and part of the accessible name.
    return html`<button
        type="button"
        class="link-button"
        data-testid="md-link"
        @click=${() => void this.activate(ordinal, r.view, decision.url)}
      >
        ${label} <span class="link-host" data-testid="md-link-host">(${decision.hostname})</span></button
      ><span role="status" data-testid="md-link-status" data-outcome=${outcome ?? nothing}
        >${outcome === undefined ? nothing : this.feedback(outcome, decision.url)}</span
      >`;
  }

  /** A link that was not opened stays readable: its destination is shown as inert text. */
  private feedback(outcome: LinkOpenOutcome, url: string): TemplateResult {
    return outcome === 'opened'
      ? html`${LINK_FEEDBACK.opened}`
      : html`${LINK_FEEDBACK[outcome]} Destination: ${url}`;
  }

  private async activate(ordinal: number, view: ContentView, url: string): Promise<void> {
    const generation = this.generation;
    const outcome = await view.hostLinks.open(url);
    if (generation !== this.generation) return;
    this.linkOutcomes = new Map(this.linkOutcomes).set(ordinal, outcome);
  }

  private image(node: Extract<InlineNode, { kind: 'image' }>, r: Rendering): TemplateResult {
    const ordinal = r.counters.image++;
    const decision = r.view.policy.decideImage(node.source, r.images);
    if (decision.allowed && !this.failedImages.has(ordinal)) {
      const epoch = this.imageEpoch;
      // Under Strict the reader has just asked for images, so they load now rather than when scrolled near.
      return html`<img
        data-testid="md-image"
        src=${decision.url}
        alt=${node.alt}
        loading=${r.strict ? 'eager' : 'lazy'}
        decoding="async"
        referrerpolicy="no-referrer"
        @error=${() => {
          // A result from before consent ended or the content changed is not this image's.
          if (epoch === this.imageEpoch) this.failedImages = new Set(this.failedImages).add(ordinal);
        }}
      />`;
    }
    const reason = decision.allowed ? 'load-failed' : decision.reason;
    const alt = node.alt === '' ? 'no description' : node.alt;
    if (r.strict) {
      return blockedFragment({
        kind: 'image',
        testId: 'md-image-blocked',
        reason,
        revealed: r.revealed,
        placeholder: `[Image blocked: ${alt}]`,
        source: () => html`![${node.alt}](${node.source})`,
      });
    }
    return html`<span data-testid="md-image-blocked" data-reason=${reason}>[Image not loaded: ${alt}]</span>`;
  }
}
