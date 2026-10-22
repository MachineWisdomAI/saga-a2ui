import {
  closesWithParagraph,
  describeContentFailure,
  describeLinkOutcome,
  FAITHFUL_CARD_STYLING,
  requestLinkOpen,
  type BlockNode,
  type ImageConsent,
  type ImageContext,
  type InlineNode,
  type InterpretedCard,
  type LinkOpenOutcome,
  type ReadResult,
  type FaithfulCardReader,
  type TableCell,
} from '@saga-a2ui/components/faithful-card';
import {
  LitElement,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { adoptStyles, type StyleRoot } from './adopt-styles.js';
import { blockedFragment } from './blocked-fragment.js';
import { requestContentView, type ContentView } from './content-view.js';

// Renders a FaithfulCard. The components package has already reduced the Markdown to a closed set
// of nodes; every case below is a fixed template with text bindings. Nothing here builds markup
// from text (no unsafeHTML, innerHTML or equivalent), and a link or image is used only when the
// view's trusted content policy permits it.
//
// Under Strict the element also owns two reader controls. Reveal/Hide source changes visibility
// only. Show/Hide images grants or revokes consent for this card in this view; the grant is bound
// to the element, so a content change, a view-wide revocation, Hide images and disconnection each
// retire it, and nothing holding the old grant can bring images back.
//
// Styling: the element uses the light DOM, so an application styles it with ordinary CSS. It emits
// the styling surface of `FAITHFUL_CARD_STYLING` (the committed class names, the nine custom
// properties, each with a neutral fallback, and the closing marker), exactly as the React card
// does; docs/faithful-card-styling.md is its documentation. Other attributes, such as the
// `data-testid` and `data-annotation` hooks, are not contract.

/** What one render pass needs; assembled once so the node templates stay small. */
interface Rendering {
  readonly view: ContentView;
  readonly strict: boolean;
  /** Whether blocked fragments are shown as source text rather than placeholders. */
  readonly revealed: boolean;
  readonly images: ImageContext;
  /** The content revision this render shows; every control it renders is bound to it (see `current`). */
  readonly revision: Revision;
  readonly counters: { link: number; image: number; table: number };
}

/**
 * Identifies the rendered card revision a control belongs to: the element's lifetime counter (it
 * advances on new content, disconnection and reconnection) and the supplied values themselves, so a
 * control that outlives its render is recognisable even before the next update has run.
 */
interface Revision {
  readonly generation: number;
  readonly contractVersion: unknown;
  readonly markdown: unknown;
}

/** The supplied values read once by one reader: the card, or why it was refused. */
type Interpretation = {
  readonly contractVersion: unknown;
  readonly markdown: unknown;
  readonly reader: FaithfulCardReader;
} & ReadResult;

const STYLE = html`<style>
  saga-faithful-card-content {
    display: block;
  }
  .saga-card {
    display: block;
    box-sizing: border-box;
    max-inline-size: var(--saga-card-reading-width, 70ch);
    font-family: var(--saga-card-font-family, inherit);
    font-size: var(--saga-card-font-size, inherit);
    line-height: var(--saga-card-line-height, inherit);
    color: var(--saga-card-text-color, inherit);
    overflow-wrap: anywhere;
  }
  .saga-card .saga-card-link {
    font: inherit;
    color: var(--saga-card-accent-color, inherit);
    background: none;
    border: 0;
    padding: 0;
    text-decoration: underline;
    cursor: pointer;
  }
  .saga-card .saga-card-link-host {
    font-size: 0.85em;
    color: var(--saga-card-muted-color, inherit);
  }
  .saga-card img {
    max-inline-size: 100%;
    height: auto;
  }
  /* A list item pads on the side its own text starts from, so a right-to-left item inside a left-to-right list
     keeps its marker inside the card instead of outside the page edge. */
  .saga-card ul,
  .saga-card ol {
    padding-inline: 0;
  }
  .saga-card li {
    margin-inline-start: 2.5em;
  }
  .saga-card blockquote {
    margin-inline: 1em;
    padding-inline-start: 0.75em;
    border-inline-start: 3px solid
      var(--saga-card-accent-color, var(--saga-card-border-color, #999));
  }
  .saga-card pre {
    max-inline-size: 100%;
    overflow-x: auto;
    padding: 0.5em;
    background: var(--saga-card-code-background, rgba(127, 127, 127, 0.15));
  }
  .saga-card code {
    background: var(--saga-card-code-background, rgba(127, 127, 127, 0.15));
  }
  .saga-card pre code {
    background: none;
  }
  .saga-card hr {
    border: 0;
    border-top: 1px solid var(--saga-card-border-color, #999);
  }
  .saga-card .saga-card-table-scroll {
    max-inline-size: 100%;
    overflow-x: auto;
    margin-block: 0.5em;
  }
  .saga-card table {
    border-collapse: collapse;
    overflow-wrap: normal;
  }
  .saga-card th,
  .saga-card td {
    border: 1px solid var(--saga-card-border-color, #999);
    padding: 0.25em 0.5em;
    text-align: start;
  }
  .saga-card [data-align='left'] {
    text-align: left;
  }
  .saga-card [data-align='center'] {
    text-align: center;
  }
  .saga-card [data-align='right'] {
    text-align: right;
  }
  .saga-card .saga-card-source {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .saga-card [data-annotation]:not([data-annotation='link-host']),
  .saga-card .saga-card-placeholder {
    font-style: italic;
  }
  .saga-card .saga-card-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em;
    margin-block: 0.5em;
  }
</style>`;

/**
 * The FaithfulCard Lit element. It shows the supplied Markdown under the enclosing view's trusted
 * reader and policy. Supplied values are untrusted: the view's reader validates them and the card
 * shows an explicit failure, with nothing of any earlier content, when they are refused.
 */
export class FaithfulCardContentElement extends LitElement {
  // Reactive properties are declared with `static properties` and `declare`, and set in the
  // constructor, not with decorators and field initializers: this package ships TypeScript source
  // that each application compiles with its own settings, and those constructs are only correct
  // under the settings the workspace happens to use.
  static override properties = {
    contractVersion: { attribute: false },
    markdown: { attribute: false },
    linkOutcomes: { state: true },
    failedImages: { state: true },
    sourceRevealed: { state: true },
    consent: { state: true },
    consentEnded: { state: true },
  };

  /** The contract version of the content, as supplied. Validated by the view's reader. */
  declare contractVersion: unknown;
  /** The Markdown to show, exactly as supplied. Validated by the view's reader. */
  declare markdown: unknown;

  declare private linkOutcomes: ReadonlyMap<number, LinkOpenOutcome>;
  declare private failedImages: ReadonlySet<number>;
  declare private sourceRevealed: boolean;
  /** The reader's current consent to load images. Absent until Show images, and after any revocation. */
  declare private consent?: ImageConsent;
  /** True once the view has retired image consent for good (host teardown). No control can grant after it. */
  declare private consentEnded: boolean;

  constructor() {
    super();
    this.contractVersion = undefined;
    this.markdown = undefined;
    this.linkOutcomes = new Map();
    this.failedImages = new Set();
    this.sourceRevealed = false;
    this.consentEnded = false;
  }

  private view?: ContentView;
  /** Gives back the application's styles this card adopted into its root; see `adopt-styles.ts`. */
  private releaseStyles?: () => void;
  private interpreted?: Interpretation;
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
    this.releaseStyles = adoptStyles(
      this.getRootNode() as unknown as StyleRoot,
      this.view?.styles ?? [],
    );
    this.consentEnded = this.view?.consent.retired === true;
    this.revocationWatch = this.view?.consent.subscribe(() => {
      this.retireImages();
      this.consentEnded = this.view?.consent.retired === true;
    });
    // A reconnected card starts fresh, like new content: the policy's own presentation, no link
    // results from before, and a render against the view it has now. Disconnecting rendered it
    // without one, and nothing else would ask for another render.
    this.generation += 1;
    this.linkOutcomes = new Map();
    this.sourceRevealed =
      this.view?.policy.blockedPresentation === 'inert-text';
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.generation += 1;
    this.revocationWatch?.unsubscribe();
    this.revocationWatch = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.retireImages();
    this.view = undefined;
    this.interpreted = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('contractVersion') || changed.has('markdown')) {
      this.generation += 1;
      this.linkOutcomes = new Map();
      // New content starts from the policy's own presentation and needs fresh consent.
      this.sourceRevealed =
        this.view?.policy.blockedPresentation === 'inert-text';
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

  /** Reads the current content once per reader, with the blockable fragments it references. */
  private interpretation(view: ContentView): Interpretation {
    const cached = this.interpreted;
    if (
      cached?.reader === view.reader &&
      cached.contractVersion === this.contractVersion &&
      cached.markdown === this.markdown
    )
      return cached;
    const { contractVersion, markdown } = this;
    this.interpreted = {
      contractVersion,
      markdown,
      reader: view.reader,
      ...view.reader.read({ contractVersion, markdown }),
    };
    return this.interpreted;
  }

  private imageContext(view: ContentView): ImageContext {
    return {
      enforcement: view.imageEnforcement,
      consent: this.consent?.live === true ? 'granted' : 'not-granted',
    };
  }

  private failure(reason: string, message: TemplateResult): TemplateResult {
    return html`${STYLE}
      <p
        class="saga-card saga-card-failure"
        role="alert"
        data-testid="card-failure"
        data-reason=${reason}
      >
        ${message}
      </p>`;
  }

  protected override render(): TemplateResult {
    const view = this.view;
    // Without a view that supplies the trusted reader and policy, nothing is interpreted or shown.
    if (view === undefined)
      return this.failure(
        'no-view',
        html`This content cannot be shown: no content view is available.`,
      );
    const interpretation = this.interpretation(view);
    if (!interpretation.ok) {
      const { failure } = interpretation;
      return this.failure(
        failure.kind,
        html`${describeContentFailure(failure)}`,
      );
    }
    const { card } = interpretation;
    const rendering: Rendering = {
      view,
      strict: view.policy.level === 'strict',
      revealed: this.sourceRevealed,
      images: this.imageContext(view),
      revision: this.revisionNow(),
      counters: { link: 0, image: 0, table: 0 },
    };
    const closing = closesWithParagraph(card.blocks)
      ? card.blocks.length - 1
      : -1;
    return html`${STYLE}
      <div class="saga-card" data-testid="card-root">
        ${rendering.strict ? this.controls(view, card) : nothing}
        <div class="saga-card-content" data-testid="card-content">
          ${card.blocks.map((block, index) =>
            this.block(block, rendering, false, index === closing),
          )}
        </div>
      </div>`;
  }

  /** Strict only. Both buttons keep one template, so focus stays on the control the reader used. */
  private controls(view: ContentView, card: InterpretedCard): TemplateResult {
    const { fragments } = card;
    const blockable =
      fragments.links + fragments.images.length + fragments.rawHtml > 0;
    const granted = this.consent?.live === true;
    const offer = view.policy.offerImages(
      fragments.images,
      view.imageEnforcement,
    );
    const unavailableReason =
      !granted && !offer.available ? offer.reason : undefined;
    const ended = !granted && this.consentEnded;
    // The controls belong to the content revision they were rendered for; see `current`.
    const revision = this.revisionNow();
    return html`<div class="saga-card-controls" data-testid="card-controls">
      ${
        blockable
          ? html`<button
              type="button"
              data-testid="source-toggle"
              @click=${() => {
                if (this.current(view, revision))
                  this.sourceRevealed = !this.sourceRevealed;
              }}
            >
              ${this.sourceRevealed ? 'Hide source' : 'Reveal source'}
            </button>`
          : nothing
      }
      ${
        fragments.images.length === 0
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
              ${
                ended
                  ? html`<span
                      data-testid="images-unavailable"
                      data-reason="view-ended"
                      >Images can no longer be shown: this view has ended.</span
                    >`
                  : nothing
              }
              ${
                unavailableReason === undefined
                  ? nothing
                  : html`<span
                      data-testid="images-unavailable"
                      data-reason=${unavailableReason}
                      >Images in this content cannot be shown: none is permitted
                      by the content policy or this host.</span
                    >`
              }`
      }
    </div>`;
  }

  /**
   * Whether a control rendered for `view` at content revision `revision` still belongs to this
   * element's current state. A control the reader (or old code) kept hold of after the content
   * changed, or after the element was disconnected, is stale and must do nothing: consent is for
   * the content the reader was shown, not whatever is current when it fires.
   */
  private current(view: ContentView, revision: Revision): boolean {
    return (
      this.view === view &&
      this.generation === revision.generation &&
      this.contractVersion === revision.contractVersion &&
      this.markdown === revision.markdown
    );
  }

  private revisionNow(): Revision {
    return {
      generation: this.generation,
      contractVersion: this.contractVersion,
      markdown: this.markdown,
    };
  }

  /** Records consent for the current content. Callers have already checked the control is current. */
  private showImages(view: ContentView): void {
    const interpretation = this.interpretation(view);
    if (this.view !== view || !interpretation.ok) return;
    if (
      !view.policy.offerImages(
        interpretation.card.fragments.images,
        view.imageEnforcement,
      ).available
    )
      return;
    this.imageEpoch += 1;
    this.consent?.revoke();
    const grant = view.consent.grant();
    if (grant.live) this.consent = grant; // a retired view hands out only dead grants
  }

  private block(
    node: BlockNode,
    r: Rendering,
    inContainer = false,
    closing = false,
  ): TemplateResult {
    // A quote or list item sets the direction its own marker or rule follows from its text, and its
    // paragraphs inherit it: automatic direction ignores any descendant that sets its own.
    const dir = inContainer ? nothing : 'auto';
    switch (node.kind) {
      case 'paragraph':
        // Only the card's final top-level block can be closing; see `FAITHFUL_CARD_STYLING.closing`.
        return html`<p
          dir=${dir}
          data-saga-closing=${closing ? FAITHFUL_CARD_STYLING.closing.value : nothing}
        >
          ${this.inlines(node.children, r)}
        </p>`;
      case 'heading': {
        // The surrounding page owns the top levels; card headings start at h3.
        const content = this.inlines(node.children, r);
        if (node.level === 1) return html`<h3 dir=${dir}>${content}</h3>`;
        if (node.level === 2) return html`<h4 dir=${dir}>${content}</h4>`;
        if (node.level === 3) return html`<h5 dir=${dir}>${content}</h5>`;
        return html`<h6 dir=${dir}>${content}</h6>`;
      }
      case 'quote':
        return html`<blockquote dir="auto">
          ${node.children.map((child) => this.block(child, r, true))}
        </blockquote>`;
      case 'list': {
        const items = node.items.map(
          (item) =>
            html`<li dir="auto">
              ${item.map((child) => this.block(child, r, true))}
            </li>`,
        );
        return node.ordered
          ? html`<ol start=${node.start}>
              ${items}
            </ol>`
          : html`<ul>
              ${items}
            </ul>`;
      }
      case 'table':
        return this.table(node, r);
      case 'code-block':
        return html`<pre dir="auto"><code>${node.text}</code></pre>`;
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
          : html`<p class="saga-card-source" dir=${dir}>${node.text}</p>`;
      case 'rule':
        return html`<hr />`;
    }
  }

  /**
   * A table scrolls inside a keyboard-focusable region so a narrow screen never forces the page
   * to scroll sideways. Each cell keeps its own inline content, in source order.
   */
  private table(
    node: Extract<BlockNode, { kind: 'table' }>,
    r: Rendering,
  ): TemplateResult {
    const ordinal = ++r.counters.table;
    const cell = (tag: 'th' | 'td', one: TableCell) => {
      const content = this.inlines(one.children, r);
      return tag === 'th'
        ? html`<th scope="col" dir="auto" data-align=${one.align ?? nothing}>
            ${content}
          </th>`
        : html`<td dir="auto" data-align=${one.align ?? nothing}>
            ${content}
          </td>`;
    };
    return html`<div
      class="saga-card-table-scroll"
      role="region"
      tabindex="0"
      aria-label=${`Table ${ordinal}`}
      data-testid="md-table"
    >
      <table>
        <thead>
          <tr>
            ${node.header.map((one) => cell('th', one))}
          </tr>
        </thead>
        <tbody>
          ${node.rows.map(
            (row) =>
              html`<tr>
                ${row.map((one) => cell('td', one))}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  private inlines(
    nodes: readonly InlineNode[],
    r: Rendering,
  ): TemplateResult[] {
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
      case 'strikethrough':
        return html`<s>${this.inlines(node.children, r)}</s>`;
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

  private link(
    node: Extract<InlineNode, { kind: 'link' }>,
    r: Rendering,
  ): TemplateResult {
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
      return html`<span
        class="saga-card-link-inert"
        data-testid="md-link-inert"
        data-reason=${decision.reason}
        >${label}
        <span class="saga-card-link-destination"
          >(${node.destination})</span
        ></span
      >`;
    }
    const outcome = this.linkOutcomes.get(ordinal);
    // The hostname is inside the button, so it is both visible and part of the accessible name.
    return html`<button
        type="button"
        class="saga-card-link"
        data-testid="md-link"
        @click=${() => void this.activate(ordinal, r.view, r.revision, decision.url)}
      >
        ${label}
        <span
          class="saga-card-link-host"
          data-testid="md-link-host"
          data-annotation="link-host"
          >(${decision.hostname})</span
        ></button
      ><span
        class="saga-card-link-status"
        role="status"
        data-testid="md-link-status"
        data-outcome=${outcome ?? nothing}
        >${outcome === undefined ? nothing : this.feedback(outcome, decision.url)}</span
      >`;
  }

  /** A link that was not opened stays readable: its destination is shown as inert text. */
  private feedback(outcome: LinkOpenOutcome, url: string): TemplateResult {
    return html`${describeLinkOutcome(outcome, url)}`;
  }

  /**
   * Asks the host to open a link, but only for the card revision the button was rendered for: a
   * button kept after the content changed or the card was removed asks nothing, and an answer that
   * arrives after that is not shown.
   */
  private async activate(
    ordinal: number,
    view: ContentView,
    revision: Revision,
    url: string,
  ): Promise<void> {
    if (!this.current(view, revision)) return;
    const outcome = await requestLinkOpen(view.hostLinks, url);
    if (!this.current(view, revision)) return;
    this.linkOutcomes = new Map(this.linkOutcomes).set(ordinal, outcome);
  }

  private image(
    node: Extract<InlineNode, { kind: 'image' }>,
    r: Rendering,
  ): TemplateResult {
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
          if (epoch === this.imageEpoch)
            this.failedImages = new Set(this.failedImages).add(ordinal);
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
    return html`<span
      class="saga-card-placeholder"
      data-testid="md-image-blocked"
      data-reason=${reason}
      data-annotation="image-not-loaded"
      >[Image not loaded: ${alt}]</span
    >`;
  }
}
