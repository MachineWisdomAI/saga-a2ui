import {
  createInstanceHost,
  snapshotLimits,
  type InstanceView,
  type Limits,
} from '@saga-a2ui/core/actions';
import type { A2uiActions } from '../a2ui/app-element.js';
import { mountOwners } from './mount-owner.js';

export interface LitActionsOptions {
  /**
   * Application setup. Run once per presented surface, before it renders, with a view owned by
   * that presentation alone. Discover instances with `watchById` (or `getById` for a unique ID)
   * and bind definitions to the handles it delivers. Everything bound through those handles is
   * disposed when the presentation ends.
   */
  readonly attach: (view: InstanceView) => void;
  /**
   * Receives the error of a setup that throws, and of a discovery callback that fails after
   * setup began. The element shows its safe fallback in the first case; the error text itself
   * goes only here, never into the page.
   */
  readonly onSetupError: (error: unknown) => void;
  /**
   * This application's defaults for every action bound through the integration: used for each
   * bound (`deadlineMs`, `hookMs`) an action does not override itself, and before the SDK defaults
   * of 30,000 ms of work and 5,000 ms per awaited hook or cleanup step. Each supplied value is
   * checked when the integration is created, and copied, so changing the object afterwards
   * affects nothing. Each presentation's host gets the same values; another integration has its own.
   */
  readonly limits?: Limits;
}

/**
 * Makes `createA2uiAppElement` give each presented surface its own action host. Passing the
 * result as `actions` is the one place an application opts in.
 *
 * Each actual mount owns its host, its bindings and its discovery subscriptions. They end when the
 * surface is deleted or replaced, when setup fails, and when the app element disconnects. A
 * reconnected element presents a new surface and so starts with a new host and a new `attach`.
 */
export function createLitActions(options: LitActionsOptions): A2uiActions {
  const limits = snapshotLimits(options.limits);
  return {
    begin(presentation) {
      const host = createInstanceHost({
        onSetupError: options.onSetupError,
        limits,
      });
      const end = (): void => {
        host.close();
        if (mountOwners.get(presentation.owner)?.host === host)
          mountOwners.delete(presentation.owner);
      };
      mountOwners.set(presentation.owner, {
        host,
        surface: presentation.surface,
        mount: presentation.mount,
      });
      try {
        host.register(options.attach);
      } catch (error) {
        end();
        options.onSetupError(error);
        throw error;
      }
      return end;
    },
  };
}
