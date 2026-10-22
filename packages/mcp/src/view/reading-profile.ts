import type { HostContext } from './run-tool-result-view.js';

/**
 * How a reader meets the view: on a `device` (a voice-assistant screen or a phone, read at arm's
 * length) or on a `desktop` (a browser or desktop application). A renderer-neutral decision for
 * the caller to map onto its own reader options; the view applies none itself.
 */
export type ReadingProfile = 'device' | 'desktop';

// The host named by the recorded observations
// (docs/2026-10-19_host-compatibility-observations_v1.md) that is read on a device: the Alexa+
// simulator. ChatGPT web and Claude web are the recorded desktop readings. The record names the
// products, not the string each reports as its `hostInfo.name`, so the match is deliberately by
// product word and no other host name is guessed at.
const DEVICE_HOST = /alexa/i;

/**
 * The reading profile for the negotiated host context and the host's reported name.
 *
 * A known device host reads as `device` whatever platform it declares; otherwise a declared
 * `mobile` platform does; everything else, including no information at all, reads as `desktop`.
 */
export function readingProfile(
  context: HostContext | undefined,
  hostName: string | undefined,
): ReadingProfile {
  if (hostName !== undefined && DEVICE_HOST.test(hostName)) return 'device';
  return context?.platform === 'mobile' ? 'device' : 'desktop';
}
