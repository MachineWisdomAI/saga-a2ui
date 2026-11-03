import type { SurfaceLayout } from '@saga-a2ui/core/protocols/a2ui/v0_9';

/**
 * A layout whose opening is hand-written wire messages. Only test pages that exist to exercise the
 * protocol path with shapes `defineSurface` deliberately does not express (many scenarios of one
 * action harness, each with templates, function calls and its own data) use it; an application
 * never does. It takes no data update, because it has no schema to validate one against.
 */
export function rawLayout(
  surfaceId: string,
  catalogId: string,
  opening: readonly unknown[],
): SurfaceLayout<never> {
  return {
    surfaceId,
    catalogId,
    // No typed data exists, so nothing reads this.
    initial: undefined as never,
    opening,
    update: () => ({
      ok: false,
      failure: {
        kind: 'invalid-data',
        message: 'This test layout takes protocol messages only.',
      },
    }),
  };
}
