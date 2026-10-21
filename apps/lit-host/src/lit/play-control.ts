import type { InstanceHost, OpenInstance } from '@saga-a2ui/core/actions';
import { LitElement, css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import {
  presentationFor,
  type PlayControlAction,
} from '../playback/play-presentation.js';
import {
  PLAY_CONTROL_ID,
  PlayControl,
  type PlayControlEvents,
  type PlaybackViewState,
} from '../playback/playback-view.js';

/**
 * The Play control: one button and one status line for the controller's current state.
 *
 * Presentation only. It never decides whether playback is allowed; it hands the user's press, still
 * inside the click event, to whatever action the application bound to this exact rendered instance,
 * and shows whatever state it is given. It opens one instance on the host it is given and retires it
 * when it leaves the document; the application's setup finds it by `PLAY_CONTROL_ID` and binds to it.
 *
 * Accessibility: the button stays in place and focusable while a request is pending (it is marked
 * `aria-disabled` and `aria-busy` rather than removed or `disabled`), so a keyboard user is not
 * stranded; every change is announced through one polite status region; and when a state removes
 * the button while it had focus, focus moves to the status instead of falling to the page.
 * Layout wraps instead of overflowing, so it reflows at a 320px width and with enlarged text.
 */
export class PlayControlElement extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 100%;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
    }
    .root {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    button {
      box-sizing: border-box;
      max-width: 100%;
      min-width: 2.75rem;
      min-height: 2.75rem;
      padding: 0.5rem 1rem;
      font: inherit;
      white-space: normal;
      cursor: pointer;
    }
    button[aria-disabled='true'] {
      cursor: progress;
      opacity: 0.7;
    }
    button:focus-visible,
    .status:focus-visible {
      outline: 3px solid Highlight;
      outline-offset: 2px;
    }
    .status {
      flex: 1 1 12rem;
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }
  `;

  @property({ attribute: false }) state: PlaybackViewState = {
    kind: 'no-selection',
  };

  private buttonHadFocus = false;
  #host: InstanceHost | undefined;
  #instance: OpenInstance<PlayControlEvents> | undefined;

  /** The action host this control opens its instance on. Set once, before or after it connects. */
  get host(): InstanceHost | undefined {
    return this.#host;
  }
  set host(value: InstanceHost | undefined) {
    if (value === this.#host) return;
    this.#retire();
    this.#host = value;
    this.#open();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#open();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#retire();
  }

  #open(): void {
    const host = this.#host;
    if (!host || this.#instance || !this.isConnected) return;
    this.#instance = host.open<PlayControlEvents>({
      kind: PlayControl,
      componentId: PLAY_CONTROL_ID,
      dataPath: '/',
      events: ['play', 'pause', 'resume'],
      // A fresh pull on every call: the control left the document, or was given another host.
      isLive: () => this.isConnected && this.#host === host,
      read: () => undefined, // the control shows no data scope of its own
    });
  }

  #retire(): void {
    this.#instance?.retire();
    this.#instance = undefined;
  }

  protected override willUpdate(): void {
    const button = this.renderRoot.querySelector('button');
    this.buttonHadFocus =
      button !== null && button === this.shadowRoot?.activeElement;
  }

  protected override updated(): void {
    if (this.buttonHadFocus && !this.renderRoot.querySelector('button')) {
      this.renderRoot.querySelector<HTMLElement>('.status')?.focus();
    }
  }

  private press(
    action: PlayControlAction,
    busy: boolean | undefined,
    event: Event,
  ): void {
    if (busy) return; // a pending request ignores the press; the bound action's busy policy also does
    // Synchronous, inside the click: the bound action's activation prefix runs in this call stack.
    this.#instance?.activate(action, event);
  }

  protected override render() {
    const shown = presentationFor(this.state);
    return html`<div
      class="root"
      data-testid="play-root"
      data-state=${this.state.kind}
    >
      ${
        shown.button
          ? html`<button
              type="button"
              data-testid="play-button"
              aria-disabled=${shown.busy ? 'true' : 'false'}
              aria-busy=${shown.busy ? 'true' : 'false'}
              @click=${(event: Event) => this.press(shown.button?.action ?? 'play', shown.busy, event)}
            >
              ${shown.button.label}
            </button>`
          : nothing
      }
      <p
        class="status"
        data-testid="play-status"
        role="status"
        aria-live="polite"
        tabindex="-1"
      >
        ${shown.status}
      </p>
    </div>`;
  }
}
