# Installing the React renderer with MCP

Use SAGA's React A2UI entry point for surfaces and catalogs:

```ts
import {Catalog, Surface, openSurface, type BoundSurface, type ReactCatalogComponent} from '@saga-a2ui/react/a2ui';
import {faithfulCardEntry} from '@saga-a2ui/react/faithful-card';
import {defineSurface} from '@saga-a2ui/core/protocols/a2ui/v0_9';
```

The entry point forwards the supported upstream A2UI v0.9 APIs; it does not implement another renderer or parser. It also exports `SurfaceModel`, `CommonSchemas`, `createComponentImplementation`, `ReactComponentImplementation` and `NodeViewProps` for custom catalogs.

## Open a typed surface

Define the surface once with `defineSurface`, open it with your catalog and mount it:

```tsx
const bound = openSurface(layout, catalog); // throws, with the session's message, if the layout is not accepted
<Surface of={bound.handle} />
bound.update(data); // {ok: true} | {ok: false, message}
bound.dispose();    // idempotent
```

`openSurface` owns the message session, the decoder and the order of the opening messages, so application code imports none of them. `update` is typed from the layout, validates against its schema and applies the data in place: the mounted controls keep their DOM nodes, focus, local state and action bindings. A rejected update returns the failure and changes nothing. After `dispose`, `update` fails and `<Surface>` renders nothing. Open the surface once per surface lifetime, outside render (for example in state or a store), and dispose it where you created it: `<Surface>` never disposes the handle, so Strict Mode's replay of effects cannot end it.

`A2uiSurface` and `SurfaceModel` stay exported for custom use over a session of your own.

## Let SAGA own its A2UI installation

Applications using this integration should not add direct dependencies on `@a2ui/react` or `@a2ui/web_core`, or import their catalog/surface APIs directly. Migrate those imports to `@saga-a2ui/react/a2ui` and remove the direct dependencies. Keep React and React DOM as the application's declared peers at the versions supported by SAGA.

SAGA React owns A2UI 0.13.0 and explicitly depends on Zod 3.25.76. MCP Apps and MCP tool schemas use Zod 4. Both versions are intentionally installed. A direct application-level A2UI React dependency can receive the application's Zod 4 peer under pnpm, making its catalog types incompatible with A2UI's Zod 3 types. A re-export alone does not solve this: the explicit Zod 3 dependency and removal of the application's direct A2UI dependencies are both necessary.

For custom A2UI schemas use `z` from `@saga-a2ui/core/protocols/a2ui/zod3`. For MCP tool schemas use the application's Zod 4. Do not pass schemas between these interfaces, force a single Zod version globally, cast away the mismatch, or suppress it with `skipLibCheck`.

An application that independently uses A2UI outside this SAGA integration owns that additional dependency combination and must qualify it separately; it is not covered by SAGA's installed-consumer tests.

## Pin the compatible upstream Markdown package

A2UI 0.13.0 allows `@a2ui/markdown-it ^0.2.1`. Version 0.2.2 requires `@a2ui/web_core ^0.14.0`; this is a different upstream combination. Pin 0.2.1 at the **consumer workspace root**, where package-manager overrides take effect.

For pnpm, merge this into the destination root `pnpm-workspace.yaml` (preserve its existing workspace globs and other overrides):

```yaml
overrides:
  '@a2ui/markdown-it': '0.2.1'
```

For npm, use root `package.json`:

```json
{"overrides": {"@a2ui/markdown-it": "0.2.1"}}
```

Then regenerate and commit the destination's root lockfile. An override in a dependency's manifest is not inherited by consumers; a direct dependency pin in SAGA also does not constrain every transitive resolution. This is a required consumer setting until the supported upstream combination changes.

Run a fresh `pnpm install --strict-peer-dependencies` and the application typecheck. The SDK's `npm run test:pnpm-react` performs that check using packed SDK packages, a real MCP/A2UI consumer and no source aliases or direct A2UI dependencies. Public SDK release availability is a separate prerequisite; this test does not publish packages.
