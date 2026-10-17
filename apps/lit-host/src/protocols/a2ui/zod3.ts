// The one place this application names Zod 3. Upstream A2UI 0.13 (`@a2ui/web_core`, `@a2ui/lit`)
// builds its schemas and its `ComponentApi` contract on Zod 3 and installs its own nested copy
// of 3.25.76. Anything that authors a schema *for A2UI* (a catalog component's schema, or a type
// derived from an upstream message schema) imports `z` from here.
//
// The MCP seam is the other side of the boundary: the MCP SDK, MCP Apps and this application's
// tool contracts use Zod 4 (`import { z } from 'zod'`). Never pass a schema across: an MCP tool
// schema is Zod 4, an A2UI component schema is Zod 3, and each is validated by its own owner.
//
// `zod3` is an npm alias for the exact version upstream installs (see package.json), so its
// declarations match upstream's. `zod/v3` inside the Zod 4 package is not a substitute: its
// declarations differ, and the compiler's comparison with upstream's types exhausts memory.
export { z } from 'zod3';
