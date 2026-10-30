import { honoAdapterCases } from './starter-hono-cases.js';
import { qualifyStarter } from './starter-qualification.js';

// The `react-mcp` starter on Hono (templates/react-hono): the React view of the same application
// served by the same Hono server text as templates/lit-hono. The shared cases of
// starter-qualification.ts run against its built listener, exactly as they do for each Lit pair,
// followed by the cases the Hono pairs add (starter-hono-cases.ts). That its server is the Lit
// pair's server is checked by starter-hono.test.ts. The browser behavior of the built React view
// is qualified for every pair by apps/lit-host/e2e/starter.spec.ts.

qualifyStarter('react-hono', honoAdapterCases);
