import { StartError } from './start-failure.js';

// One view per container. A start claims the container; the claim ends when that view is gone from
// the screen (disposed, or ended by the host). A view that failed to start keeps its failure text in
// the container and so keeps the claim until the application disposes it. This is state about the
// container, not about the module: it is the one thing two starts of different entries must agree on.
const claimed = new WeakSet<Element>();

/** Claims `container` for one view, or throws `StartError` and changes nothing. Returns the release. */
export function claimContainer(container: unknown): {
  readonly container: Element;
  release(): void;
} {
  if (!(container instanceof Element) || !container.isConnected)
    throw new StartError('container-missing');
  if (claimed.has(container)) throw new StartError('container-busy');
  claimed.add(container);
  return { container, release: () => void claimed.delete(container) };
}
