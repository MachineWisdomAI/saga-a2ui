import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { InstanceHost } from '@saga-a2ui/core/actions';

/** What one app element presents while its action integration is active. */
export interface MountOwner {
  readonly host: InstanceHost;
  readonly surface: SurfaceModel<any>;
  /** The one `<a2ui-surface>` the app element rendered for this presentation. */
  readonly mount: () => Element | undefined;
}

/** Set while an app element presents one surface, and removed when that presentation ends. */
export const mountOwners = new WeakMap<Element, MountOwner>();

/**
 * Finds the host from the element's position in the DOM, not from the surface object: two
 * `<a2ui-surface .surface=${S}>` mounts for one model share that key, and both would publish into
 * one scope. The walk crosses shadow roots outward, remembers the nearest `<a2ui-surface>` it
 * passes, stops at the first element that owns a presentation, and accepts only when that nearest
 * surface element is the owner's own mount and the owner's surface is the one the element holds.
 * Light DOM or slotted content that never passes through the owner's shadow tree finds nothing.
 */
export function hostOf(
  element: Element,
  surface: SurfaceModel<any>,
): InstanceHost | undefined {
  let nearestSurfaceElement: Element | undefined;
  let root = element.getRootNode();
  while (root instanceof ShadowRoot) {
    const host = root.host;
    if (host.localName === 'a2ui-surface') nearestSurfaceElement ??= host;
    const owner = mountOwners.get(host);
    if (owner) {
      const sameMount =
        nearestSurfaceElement !== undefined &&
        nearestSurfaceElement === owner.mount();
      return owner.surface === surface && sameMount ? owner.host : undefined;
    }
    root = host.getRootNode();
  }
  return undefined;
}
