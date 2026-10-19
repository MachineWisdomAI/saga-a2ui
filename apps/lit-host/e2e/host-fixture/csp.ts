// Pure construction of the test-only host fixture's Content-Security-Policy from a hosted
// resource's own metadata. Kept free of DOM and window access so the policy can be reasoned
// about and unit tested directly, without mounting a view or importing the browser entry point.
// The host fixture (host.ts) is responsible for applying the returned policy to the iframe.

export interface ResourceCsp {
  readonly connectDomains: readonly string[];
  readonly resourceDomains: readonly string[];
}

// The fixture models a host that lets a view show images and fonts from `data:` and `blob:`
// sources, which fetch nothing from the network, and extends both with the resource's declared
// domains. The view's own document policy narrows this further (its Strict mode omits `blob:`);
// a document must satisfy the host's policy and its own.
const EMBEDDED_SCHEMES = 'data: blob:';

export function contentSecurityPolicy(csp: ResourceCsp): string {
  const resources = csp.resourceDomains.join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resources}`.trim(), // the view is one inline script
    `style-src 'unsafe-inline' ${resources}`.trim(),
    `img-src ${EMBEDDED_SCHEMES} ${resources}`.trim(),
    // MCP Apps `resourceDomains` is one broad permission: it covers images, scripts,
    // stylesheets, fonts and media alike. Narrowing it is the resource document's job.
    `font-src ${EMBEDDED_SCHEMES} ${resources}`.trim(),
    `media-src ${resources || "'none'"}`,
    `connect-src ${csp.connectDomains.join(' ') || "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
