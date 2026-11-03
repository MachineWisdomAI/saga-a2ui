import {
  describeLinkOutcome,
  type HostLinks,
} from '@saga-a2ui/core/host-links';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

/** The wording and destination used when the application configures neither. */
export const DEFAULT_ATTRIBUTION = Object.freeze({
  prefix: 'Built with',
  name: 'saga a2ui',
  href: 'https://saga-ai.dev/',
});

/**
 * The credit's trusted configuration. Every value comes from the application's own code and is
 * never read from answer, tool or catalog data. All of it is optional.
 */
export interface SagaAttributionProps {
  /**
   * The one way to ask the host to open the destination (`host.links` of the stack's view, or any
   * `HostLinks`). Without it the credit is readable text that shows its destination and
   * navigates nowhere, as it does for a page that has no host.
   */
  readonly links?: HostLinks;
  /** The text before the linked name. Default `Built with`. */
  readonly prefix?: string;
  /** The linked name. Default `saga a2ui`. */
  readonly name?: string;
  /** An absolute `https:` URL without credentials. Anything else leaves the credit as plain text. Default `https://saga-ai.dev/`. */
  readonly href?: string;
}

function textOr(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : fallback;
}

/** The destination as the host should receive it, or `undefined` when it is not an acceptable one. */
function destinationOf(href: string): string | undefined {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === ''
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A small text credit for an application that renders with the SDK: the application places it
 * where it wants it, once or on every card, and removes it by not rendering it. It reads nothing
 * from answer or catalog data, makes no network request on its own and has no dependency on the
 * FaithfulCard.
 *
 * Activating the name asks the host to open the destination, once at a time, and only through
 * `links`; there is no other way it navigates. A host that does not open it leaves the credit in
 * place and says so, with the destination as plain text. A late answer is dropped once the credit
 * is unmounted or its `links` or destination have changed.
 */
export function SagaAttribution(props: SagaAttributionProps): ReactElement {
  const prefix = textOr(props.prefix, DEFAULT_ATTRIBUTION.prefix);
  const name = textOr(props.name, DEFAULT_ATTRIBUTION.name);
  const destination = destinationOf(props.href ?? DEFAULT_ATTRIBUTION.href);
  const { links } = props;

  // Advances whenever an answer stops being the one that may be shown. Read when an answer
  // arrives and written only by effects, never during render.
  const generation = useRef(0);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setBusy(false);
    setMessage('');
    return () => {
      generation.current += 1;
    };
  }, [links, destination]);

  const open = useCallback(async (): Promise<void> => {
    if (links === undefined || destination === undefined || pending.current)
      return;
    const asked = generation.current;
    pending.current = true;
    setBusy(true);
    setMessage('');
    let outcome: Awaited<ReturnType<HostLinks['open']>>;
    try {
      outcome = await links.open(destination);
    } catch {
      outcome = 'failed';
    }
    if (generation.current !== asked) return;
    pending.current = false;
    setBusy(false);
    setMessage(describeLinkOutcome(outcome, destination));
  }, [links, destination]);

  const linked = links !== undefined && destination !== undefined;
  return (
    <p className="saga-attribution">
      {prefix}{' '}
      {linked ? (
        <button
          type="button"
          className="saga-attribution-link"
          aria-disabled={busy ? 'true' : undefined}
          onClick={() => void open()}
        >
          {name}
        </button>
      ) : (
        <span className="saga-attribution-name">{name}</span>
      )}
      {!linked && destination !== undefined ? (
        <>
          {' '}
          <span className="saga-attribution-destination">({destination})</span>
        </>
      ) : null}
      <span className="saga-attribution-status" role="status">
        {message}
      </span>
    </p>
  );
}
