// The server entry of the stack: what an application's MCP server composes to serve a card or an
// own-catalog view, from the same package it installs for the view. It re-exports the delivery
// owner's named operations and nothing from a renderer, `@saga-a2ui/components` or the browser
// entries, so a server never loads a renderer and a browser bundle never loads a server module.
// The operations, their failures and their lifetimes are specified in `@saga-a2ui/mcp/server`.
export {
  attachRequestLifetime,
  createServerBudgets,
  operationViewFromHtml,
  registerPublicOperation,
  viewUriForHtml,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
