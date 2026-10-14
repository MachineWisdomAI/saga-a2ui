// Pure construction of the test-only host fixture's Content-Security-Policy from a hosted
// resource's own metadata. Kept free of DOM and window access so the policy can be reasoned
// about and unit tested directly, without mounting a view or importing the browser entry point.
// The host fixture (host.ts) is responsible for applying the returned policy to the iframe.

export interface ResourceCsp {
  readonly connectDomains: readonly string[];
  readonly resourceDomains: readonly string[];
}

export function contentSecurityPolicy(csp: ResourceCsp): string {
  const resources = csp.resourceDomains.join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resources}`.trim(), // the view is one inline script
    `style-src 'unsafe-inline' ${resources}`.trim(),
    `img-src ${resources || "'none'"}`,
    `connect-src ${csp.connectDomains.join(' ') || "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
