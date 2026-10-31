import { createConsumerApp } from './app.js';

// The Workers entry: the application's settings are constants here; a real Worker would take them
// from its bindings. The SDK is handed the request and nothing else.
const app = createConsumerApp({
  allowedHosts: ['app.example'],
  allowedOrigins: ['app.example'],
  path: '/mcp',
});

export default {
  fetch: (request: Request): Promise<Response> => app.fetch(request),
};
