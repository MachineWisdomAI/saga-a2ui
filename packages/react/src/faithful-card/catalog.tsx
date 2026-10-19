import { createComponentImplementation, type NodeViewProps, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { FaithfulCardApi } from '@saga-a2ui/components/faithful-card';
import { createContext, useCallback, useContext } from 'react';
import { CardContent } from './card.js';

/** Whether the A2UI node that renders the card still stands; a card outside a node always does. */
const NodeLiveContext = createContext<() => boolean>(() => true);

/** Wraps an entry's generated view with what only the node knows: whether it has been disposed. */
function withNodeLiveness(implementation: ReactComponentImplementation): ReactComponentImplementation {
  const Inner = implementation.view;
  if (!Inner) throw new Error('withNodeLiveness needs an entry with a generated view');
  const View = (props: NodeViewProps) => {
    // The resolver disposes a node synchronously, possibly before React has unmounted its view, so a
    // control that is still on screen asks the node rather than trusting that it was rendered.
    const { node } = props;
    const isLive = useCallback(() => !node.disposed, [node]);
    return (
      <NodeLiveContext.Provider value={isLive}>
        <Inner {...props} />
      </NodeLiveContext.Provider>
    );
  };
  View.displayName = `${implementation.name}.node`;
  return { ...implementation, view: View };
}

/**
 * The catalog entry. An application lists it in its own catalog. It binds the contract's two values
 * to the card and nothing else: the trusted reader, policy and host callback come from the
 * enclosing {@link FaithfulCardProvider}, never from properties.
 */
export const faithfulCardEntry: ReactComponentImplementation = withNodeLiveness(
  createComponentImplementation(FaithfulCardApi, ({ props }) => {
    const isLive = useContext(NodeLiveContext);
    return <CardContent contractVersion={props.contractVersion} markdown={props.markdown} isLive={isLive} />;
  }),
);
