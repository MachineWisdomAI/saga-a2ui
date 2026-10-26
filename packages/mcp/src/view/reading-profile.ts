import type { HostContext } from './run-tool-result-view.js';

/**
 * How a reader meets the view: on a `device` (a voice-assistant screen or a phone, read at arm's
 * length) or on a `desktop` (a browser or desktop application). A renderer-neutral decision for
 * the caller to map onto its own reader options; the view applies none itself.
 */
export type ReadingProfile = 'device' | 'desktop';

// The hosts read on a device. The Alexa+ simulator is the one the recorded observations
// (docs/host-compatibility.md) name; ChatGPT web and Claude web are the
// recorded desktop readings. The record names the products, not the string each reports as its
// `hostInfo.name`, so the match is deliberately by product word and no other host name is guessed
// at. Two identities come from a consumer's fixtures instead: the historical `HTMLFragmentWrapper`
// host name, and the `deviceClass` an Echo Show host echoes in its host context (a field beyond
// the MCP Apps schema, which the context accepts and passes on). Neither is fresh host evidence.
const DEVICE_HOST = /alexa|^HTMLFragmentWrapper(?![A-Za-z])/i;
const DEVICE_CLASS = /(?:^|_)echo_show(?:_|$)/;

/**
 * The reading profile for the negotiated host context and the host's reported name.
 *
 * A known device host, or a host context that reports an Echo Show device class, reads as
 * `device` whatever platform it declares; otherwise a declared `mobile` platform does; everything
 * else, including no information at all, reads as `desktop`.
 */
export function readingProfile(
  context: HostContext | undefined,
  hostName: string | undefined,
): ReadingProfile {
  if (hostName !== undefined && DEVICE_HOST.test(hostName)) return 'device';
  const deviceClass: unknown = context?.deviceClass;
  if (typeof deviceClass === 'string' && DEVICE_CLASS.test(deviceClass))
    return 'device';
  return context?.platform === 'mobile' ? 'device' : 'desktop';
}
