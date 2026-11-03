import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';
import { FaithfulCardApi } from '@saga-a2ui/components/faithful-card';
import { html, nothing } from 'lit';

/**
 * The catalog element. It binds the contract's two values to the card element and nothing else:
 * the trusted reader, policy and callbacks come from the enclosing view, never from properties.
 */
export class FaithfulCardElement extends A2uiLitElement<
  typeof FaithfulCardApi
> {
  protected readonly api = FaithfulCardApi;

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    return html`<saga-faithful-card-content
      .contractVersion=${props.contractVersion}
      .markdown=${props.markdown}
    ></saga-faithful-card-content>`;
  }
}

/** The catalog entry. An application lists it in its own catalog, then calls `registerFaithfulCard`. */
export const faithfulCardEntry = {
  ...FaithfulCardApi,
  tagName: 'saga-faithful-card',
  element: FaithfulCardElement,
} satisfies LitComponentApi;
