import {
  snapshotLimits,
  type InstanceView,
  type Limits,
} from '@saga-a2ui/core/actions';
import { Component, type ReactNode } from 'react';
import { InstanceHostProvider, useActionSetup } from './instance-host.js';

export interface ReactActionsOptions {
  /**
   * Application setup. Run once per mounted surface, with a view owned by that mount alone.
   * Discover instances with `watchById` (or `getById` for a unique ID) and bind definitions to
   * the handles it delivers. Everything bound through those handles is disposed when the mount
   * ends.
   */
  readonly attach: (view: InstanceView) => void;
  /**
   * Receives the error of a setup that throws, and of a discovery callback that fails after
   * setup began. The error text goes only here, never into the page.
   */
  readonly onSetupError: (error: unknown) => void;
  /**
   * This application’s defaults for every action bound through the integration (`deadlineMs`,
   * `hookMs`). Checked and copied when the integration is created.
   */
  readonly limits?: Limits;
}

/** What {@link createReactActions} makes: one application’s action setup, ready to mount. */
export interface ReactActions {
  readonly attach: (view: InstanceView) => void;
  readonly onSetupError: (error: unknown) => void;
  readonly limits: Limits;
}

/**
 * The React counterpart of `createLitActions`: states the application’s action setup once. Mount
 * it around the bound surface with {@link ActionsScope}, which owns the host, the setup and the
 * failure boundary. The setup keeps one identity for the life of the value, which the setup
 * registration needs. Limits are checked here, so an invalid value throws before anything mounts.
 */
export function createReactActions(options: ReactActionsOptions): ReactActions {
  return Object.freeze({
    attach: options.attach,
    onSetupError: options.onSetupError,
    limits: snapshotLimits(options.limits),
  });
}

function Setup(props: { readonly attach: (view: InstanceView) => void }): null {
  useActionSetup(props.attach);
  return null;
}

/**
 * A setup that throws is reported to the provider’s sink and then propagates; this boundary is the
 * React counterpart of the Lit app element’s safe fallback. The sink already says why, so nothing
 * is rendered in its place and nothing stays bound.
 */
class SetupFailure extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Mounts `actions` around the surface in `children`: one action host for that subtree, the setup
 * run under it, and the failure boundary. Mount it once per rendered surface; unmounting it is
 * the explicit teardown of every instance and binding beneath it.
 */
export function ActionsScope(props: {
  readonly actions: ReactActions;
  readonly children: ReactNode;
}) {
  const { actions } = props;
  return (
    <InstanceHostProvider
      onSetupError={actions.onSetupError}
      limits={actions.limits}
    >
      <SetupFailure>
        <Setup attach={actions.attach} />
        {props.children}
      </SetupFailure>
    </InstanceHostProvider>
  );
}
