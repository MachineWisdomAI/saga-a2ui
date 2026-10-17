import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { LinkOpenOutcome } from '../content/host-links.js';
import { parseDescription, type BlockNode, type InlineNode, type ParseResult } from '../content/markdown.js';
import { requestContentView, type ContentView } from './content-view.js';

// Renders a description. The Markdown module has already reduced the text to a closed set of
// nodes; every case below is a fixed template with text bindings. Nothing here builds markup from
// text (no unsafeHTML, innerHTML or equivalent), and a link or image is used only when the
// view's trusted content policy permits it.

const LINK_FEEDBACK: Record<LinkOpenOutcome, string> = {
  opened: 'The host was asked to open this link.',
  denied: 'The host did not open this link.',
  unavailable: 'This host cannot open links.',
  failed: 'The link could not be opened.',
};

interface RenderCounters {
  link: number;
  image: number;
}

/** Light DOM on purpose: the panel's text stays inside the panel for styling and testing. */
export class SagaDescriptionElement extends LitElement {
  /** The description exactly as supplied. */
  @property({ attribute: false }) source = '';

  @state() private linkOutcomes: ReadonlyMap<number, LinkOpenOutcome> = new Map();
  @state() private failedImages: ReadonlySet<number> = new Set();

  private view?: ContentView;
  private parsed?: { readonly source: string; readonly result: ParseResult };
  /** Retires results that arrive after the content changed or the element was removed. */
  private generation = 0;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.view = requestContentView(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.generation += 1;
    this.view = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('source')) {
      this.generation += 1;
      this.linkOutcomes = new Map();
      this.failedImages = new Set();
    }
  }

  private interpretation(): ParseResult {
    if (this.parsed?.source !== this.source) this.parsed = { source: this.source, result: parseDescription(this.source) };
    return this.parsed.result;
  }

  protected override render(): TemplateResult {
    const view = this.view;
    // Without a view that supplies a policy, the text is shown exactly as written.
    if (view === undefined) return html`<p data-testid="description-plain">${this.source}</p>`;
    const result = this.interpretation();
    if (!result.ok) {
      return result.failure.kind === 'too-long'
        ? html`<p role="alert" data-testid="description-limit">
            This description is too long to display (${result.failure.length} characters; the limit is
            ${result.failure.limit}).
          </p>`
        : html`<p role="alert" data-testid="description-limit" data-reason="too-nested">
            This description is nested too deeply to display (the nesting limit is
            ${result.failure.limit} levels; a quote counts as one and a list item as two).
          </p>`;
    }
    const counters: RenderCounters = { link: 0, image: 0 };
    return html`<style>
        saga-description .link-button { font: inherit; color: inherit; background: none; border: 0; padding: 0;
          text-decoration: underline; cursor: pointer; }
        saga-description .link-host { font-size: 0.85em; }
        saga-description img { max-width: 100%; height: auto; }
        saga-description blockquote { margin-inline: 1em; padding-inline-start: 0.75em; border-inline-start: 3px solid #999; }
      </style>
      <div data-testid="description-content">${result.description.blocks.map((block) => this.block(block, view, counters))}</div>`;
  }

  private block(node: BlockNode, view: ContentView, counters: RenderCounters): TemplateResult {
    switch (node.kind) {
      case 'paragraph':
        return html`<p>${this.inlines(node.children, view, counters)}</p>`;
      case 'heading': {
        // The panel title is the h2; description headings sit below it.
        const content = this.inlines(node.children, view, counters);
        if (node.level === 1) return html`<h3>${content}</h3>`;
        if (node.level === 2) return html`<h4>${content}</h4>`;
        if (node.level === 3) return html`<h5>${content}</h5>`;
        return html`<h6>${content}</h6>`;
      }
      case 'quote':
        return html`<blockquote>${node.children.map((child) => this.block(child, view, counters))}</blockquote>`;
      case 'list': {
        const items = node.items.map(
          (item) => html`<li>${item.map((child) => this.block(child, view, counters))}</li>`,
        );
        return node.ordered ? html`<ol start=${node.start}>${items}</ol>` : html`<ul>${items}</ul>`;
      }
      case 'code-block':
        return html`<pre><code>${node.text}</code></pre>`;
      case 'rule':
        return html`<hr />`;
    }
  }

  private inlines(nodes: readonly InlineNode[], view: ContentView, counters: RenderCounters): TemplateResult[] {
    return nodes.map((node) => this.inline(node, view, counters));
  }

  private inline(node: InlineNode, view: ContentView, counters: RenderCounters): TemplateResult {
    switch (node.kind) {
      case 'text':
        return html`${node.text}`;
      case 'code':
        return html`<code>${node.text}</code>`;
      case 'emphasis':
        return html`<em>${this.inlines(node.children, view, counters)}</em>`;
      case 'strong':
        return html`<strong>${this.inlines(node.children, view, counters)}</strong>`;
      case 'softbreak':
        return html`${'\n'}`;
      case 'hardbreak':
        return html`<br />`;
      case 'link':
        return this.link(node, view, counters);
      case 'image':
        return this.image(node, view, counters);
    }
  }

  private link(
    node: Extract<InlineNode, { kind: 'link' }>,
    view: ContentView,
    counters: RenderCounters,
  ): TemplateResult {
    const ordinal = counters.link++;
    const label = this.inlines(node.children, view, counters);
    const decision = view.policy.decideLink(node.destination);
    if (!decision.allowed) {
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
        @click=${() => void this.activate(ordinal, view, decision.url)}
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

  private image(
    node: Extract<InlineNode, { kind: 'image' }>,
    view: ContentView,
    counters: RenderCounters,
  ): TemplateResult {
    const ordinal = counters.image++;
    const decision = view.policy.decideImage(node.source, view.imageEnforcement);
    if (!decision.allowed || this.failedImages.has(ordinal)) {
      const reason = decision.allowed ? 'load-failed' : decision.reason;
      return html`<span data-testid="md-image-blocked" data-reason=${reason}
        >[Image not loaded: ${node.alt === '' ? 'no description' : node.alt}]</span
      >`;
    }
    return html`<img
      data-testid="md-image"
      src=${decision.url}
      alt=${node.alt}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error=${() => {
        this.failedImages = new Set(this.failedImages).add(ordinal);
      }}
    />`;
  }
}
