// The URL rules a host's submission applies to what it publishes (CLI3 #66, CLI4 #67): a published
// link is absolute, HTTPS and free of credentials, and an MCP endpoint is also a stable public
// address. They are the same for every target; the host's name appears only in the wording.

/** A problem with a URL a listing publishes, or `null`. */
export function publishedUrlProblem(label: string, value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value === '') return `${label} is required.`;
  if (value.length > maxLength) return `${label} is longer than ${maxLength} characters.`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${label} is not an absolute URL.`;
  }
  if (url.protocol !== 'https:') return `${label} must use HTTPS.`;
  if (url.username !== '' || url.password !== '') return `${label} must not contain credentials.`;
  return null;
}

/** Whether a host name could be reached from outside the publisher's own network. IP literals are refused: the portal verifies a domain. */
function isPublicHostName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return false;
  if (!host.includes('.') || host.endsWith('.')) return false;
  return !['localhost', 'local', 'internal', 'lan', 'home.arpa', 'localdomain'].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** `null` when the URL is a stable public HTTPS MCP endpoint, otherwise what is wrong with it. */
export function endpointUrlProblem(value: string, host: string): string | null {
  const problem = publishedUrlProblem('The endpoint URL', value, 2048);
  if (problem !== null) return problem;
  const url = new URL(value);
  if (url.hash !== '') return 'The endpoint URL must not contain a fragment.';
  if (!isPublicHostName(url.hostname)) return `The endpoint host ${url.hostname} is a local or testing address; ${host} submission needs a stable public HTTPS endpoint.`;
  return null;
}
