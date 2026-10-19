import {
  describeLinkOutcome,
  type BlockNode,
  type ContentPolicy,
  type ImageContext,
  type InlineNode,
  type LinkOpenOutcome,
  type TableCell,
} from '@saga-a2ui/components/faithful-card';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { CommittedImage } from './image.js';

// Templates: the closed set of restricted nodes the components package produces, each mapped to a
// fixed element with text children. Nothing here builds markup from text (React escapes every
// string it is given, and no raw-HTML escape hatch is used), and a link or image is activatable
// only when the trusted content policy permits it. Which node cases exist is decided by the types in
// `@saga-a2ui/components/faithful-card`: both `switch` statements end in an exhaustiveness check,
// so a new case fails to compile here until it is rendered.
//
// This module holds no state and runs no effect. The lifecycle (`lifecycle.ts`) supplies the
// revision-bound controls and the consent, `image.tsx` the one element that loads, and
// `faithful-card.css` supplies the presentation through the semantic classes below.

/** What one render pass needs; assembled once so the node templates stay small. */
export interface Rendering {
  readonly policy: ContentPolicy;
  readonly strict: boolean;
  /** Whether blocked fragments are shown as source text rather than placeholders. */
  readonly revealed: boolean;
  readonly linkOutcomes: ReadonlyMap<number, LinkOpenOutcome>;
  /** Called by a link's button; the lifecycle decides whether it still stands. */
  readonly openLink: (ordinal: number, url: string) => void;
  /** The view's enforcement and the card's live consent: the inputs of every image decision. */
  readonly images: ImageContext;
  /** The same decision asked again at the moment an image would be requested, from live consent. */
  readonly imageStillPermitted: (source: string) => boolean;
  /** Image positions whose load failed under the current consent. */
  readonly failedImages: ReadonlySet<number>;
  /** Called when a shown image fails to load; the lifecycle decides whether the failure still counts. */
  readonly imageFailed: (ordinal: number) => void;
}

/** Positions in the content, counted as the templates are produced in source order. */
interface Counters {
  link: number;
  image: number;
  table: number;
}

/** The rendering plus the counters of one pass; the counters belong to the pass, never to its caller. */
type Pass = Rendering & { readonly counters: Counters };

/** Why a permitted image is shown as text: the browser could not load it. */
const IMAGE_LOAD_FAILED = 'load-failed';

function never(node: never): never {
  throw new Error(`Unhandled card node: ${JSON.stringify(node)}`);
}

/** Each element of an ordered, never-reordered list of nodes is identified by its position. */
function inOrder(elements: readonly ReactNode[]): ReactNode {
  return elements.map((element, index) => <Fragment key={index}>{element}</Fragment>);
}

type BlockedKind = 'link' | 'image' | 'markup';

/**
 * A fragment the content policy blocks (a link, an image reference or raw markup): an accessible
 * placeholder, or, once the reader reveals it, its source text, in the fragment's original position.
 * Both are fixed elements with text children, so revealing changes visibility only.
 */
function BlockedFragment(props: {
  readonly kind: BlockedKind;
  readonly testId: string;
  readonly reason: string;
  readonly revealed: boolean;
  readonly placeholder: string;
  readonly source: (label: ReactNode) => ReactNode;
  /** Ordinary text that belongs to the fragment, such as a link's label, kept in place either way. */
  readonly label?: ReactNode;
  readonly block?: boolean;
}): ReactElement {
  const { kind, testId, reason, revealed, placeholder, source, label, block } = props;
  const content = revealed ? source(label) : label === undefined ? placeholder : <>{label} {placeholder}</>;
  const common = {
    'data-testid': testId,
    'data-kind': kind,
    'data-reason': reason,
    'data-presentation': revealed ? 'source' : 'placeholder',
  };
  return block === true ? (
    <p className="saga-card-source" {...common}>
      {content}
    </p>
  ) : (
    <span className="saga-card-blocked" {...common}>
      {content}
    </span>
  );
}

/**
 * The blocks of a card. The counters are made here, inside the one render of this component, so a
 * second render of the same props (Strict Mode, or a render React discards) numbers links and
 * tables from the start again instead of continuing where the first stopped.
 */
export function Blocks(props: { readonly nodes: readonly BlockNode[]; readonly rendering: Rendering }): ReactElement {
  const pass: Pass = { ...props.rendering, counters: { link: 0, image: 0, table: 0 } };
  return <>{inOrder(props.nodes.map((node) => block(node, pass, false)))}</>;
}

function block(node: BlockNode, r: Pass, inContainer: boolean): ReactNode {
  // A quote or list item sets the direction its own marker or rule follows from its text, and its
  // paragraphs inherit it: automatic direction ignores any descendant that sets its own.
  const dir = inContainer ? undefined : 'auto';
  switch (node.kind) {
    case 'paragraph':
      return <p dir={dir}>{inlines(node.children, r)}</p>;
    case 'heading': {
      // The surrounding page owns the top levels; card headings start at h3.
      const content = inlines(node.children, r);
      if (node.level === 1) return <h3 dir={dir}>{content}</h3>;
      if (node.level === 2) return <h4 dir={dir}>{content}</h4>;
      if (node.level === 3) return <h5 dir={dir}>{content}</h5>;
      return <h6 dir={dir}>{content}</h6>;
    }
    case 'quote':
      return <blockquote dir="auto">{inOrder(node.children.map((child) => block(child, r, true)))}</blockquote>;
    case 'list': {
      const items = node.items.map((item) => <li dir="auto">{inOrder(item.map((child) => block(child, r, true)))}</li>);
      return node.ordered ? <ol start={node.start}>{inOrder(items)}</ol> : <ul>{inOrder(items)}</ul>;
    }
    case 'table':
      return table(node, r);
    case 'code-block':
      return (
        <pre dir="auto">
          <code>{node.text}</code>
        </pre>
      );
    case 'raw-html-block':
      return r.strict ? (
        <BlockedFragment
          kind="markup"
          testId="md-markup"
          reason="raw-html"
          revealed={r.revealed}
          placeholder="[Markup blocked]"
          source={() => node.text}
          block
        />
      ) : (
        <p className="saga-card-source" dir={dir}>
          {node.text}
        </p>
      );
    case 'rule':
      return <hr />;
    default:
      return never(node);
  }
}

/**
 * A table scrolls inside a keyboard-focusable region so a narrow screen never forces the page to
 * scroll sideways. Each cell keeps its own inline content, in source order.
 */
function table(node: Extract<BlockNode, { kind: 'table' }>, r: Pass): ReactNode {
  const ordinal = ++r.counters.table;
  const cell = (tag: 'th' | 'td', one: TableCell): ReactNode => {
    const content = inlines(one.children, r);
    return tag === 'th' ? (
      <th scope="col" dir="auto" data-align={one.align}>
        {content}
      </th>
    ) : (
      <td dir="auto" data-align={one.align}>
        {content}
      </td>
    );
  };
  return (
    <div className="saga-card-table-scroll" role="region" tabIndex={0} aria-label={`Table ${ordinal}`} data-testid="md-table">
      <table>
        <thead>
          <tr>{inOrder(node.header.map((one) => cell('th', one)))}</tr>
        </thead>
        <tbody>{inOrder(node.rows.map((row) => <tr>{inOrder(row.map((one) => cell('td', one)))}</tr>))}</tbody>
      </table>
    </div>
  );
}

function inlines(nodes: readonly InlineNode[], r: Pass): ReactNode {
  return inOrder(nodes.map((node) => inline(node, r)));
}

function inline(node: InlineNode, r: Pass): ReactNode {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'code':
      return <code>{node.text}</code>;
    case 'emphasis':
      return <em>{inlines(node.children, r)}</em>;
    case 'strong':
      return <strong>{inlines(node.children, r)}</strong>;
    case 'strikethrough':
      return <s>{inlines(node.children, r)}</s>;
    case 'softbreak':
      return '\n';
    case 'hardbreak':
      return <br />;
    case 'raw-html':
      return r.strict ? (
        <BlockedFragment
          kind="markup"
          testId="md-markup"
          reason="raw-html"
          revealed={r.revealed}
          placeholder="[Markup blocked]"
          source={() => node.text}
        />
      ) : (
        node.text
      );
    case 'link':
      return link(node, r);
    case 'image':
      return image(node, r);
    default:
      return never(node);
  }
}

function link(node: Extract<InlineNode, { kind: 'link' }>, r: Pass): ReactNode {
  const ordinal = r.counters.link++;
  const label = inlines(node.children, r);
  const decision = r.policy.decideLink(node.destination);
  if (!decision.allowed) {
    if (r.strict) {
      // Strict never activates a link, even an otherwise valid one.
      return (
        <BlockedFragment
          kind="link"
          testId="md-link-inert"
          reason={decision.reason}
          revealed={r.revealed}
          placeholder="[Link blocked]"
          label={label}
          source={(text) => <>[{text}]({node.destination})</>}
        />
      );
    }
    // Not activatable: the text and its destination are shown, and nothing can be invoked.
    return (
      <span className="saga-card-link-inert" data-testid="md-link-inert" data-reason={decision.reason}>
        {label} <span className="saga-card-link-destination">({node.destination})</span>
      </span>
    );
  }
  const outcome = r.linkOutcomes.get(ordinal);
  // The hostname is inside the button, so it is both visible and part of the accessible name. The
  // control has no destination of its own (no href), so there is no navigation to fall back to.
  return (
    <>
      <button type="button" className="saga-card-link" data-testid="md-link" onClick={() => r.openLink(ordinal, decision.url)}>
        {label} <span className="saga-card-link-host" data-testid="md-link-host">({decision.hostname})</span>
      </button>
      <span className="saga-card-link-status" role="status" data-testid="md-link-status" data-outcome={outcome}>
        {outcome === undefined ? null : describeLinkOutcome(outcome, decision.url)}
      </span>
    </>
  );
}

/**
 * An image is an element only when the policy permits it for this view: an exactly listed HTTPS
 * host, demonstrated enforcement and, under Strict, the reader's live consent. Anything else, and
 * an image that failed to load, stays inert text in its original position (under Strict it can be
 * revealed as source). Data and blob references are never permitted, so they are always that text.
 */
function image(node: Extract<InlineNode, { kind: 'image' }>, r: Pass): ReactNode {
  const ordinal = r.counters.image++;
  const decision = r.policy.decideImage(node.source, r.images);
  if (decision.allowed && !r.failedImages.has(ordinal)) {
    return (
      <CommittedImage
        url={decision.url}
        alt={node.alt}
        eager={r.strict}
        stillPermitted={() => r.imageStillPermitted(node.source)}
        onFailure={() => r.imageFailed(ordinal)}
      />
    );
  }
  const reason = decision.allowed ? IMAGE_LOAD_FAILED : decision.reason;
  const alt = node.alt === '' ? 'no description' : node.alt;
  if (r.strict) {
    return (
      <BlockedFragment
        kind="image"
        testId="md-image-blocked"
        reason={reason}
        revealed={r.revealed}
        placeholder={`[Image blocked: ${alt}]`}
        source={() => `![${node.alt}](${node.source})`}
      />
    );
  }
  return (
    <span className="saga-card-placeholder" data-testid="md-image-blocked" data-reason={reason}>
      [Image not loaded: {alt}]
    </span>
  );
}
