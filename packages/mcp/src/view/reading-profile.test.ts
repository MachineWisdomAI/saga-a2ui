import { describe, expect, it } from 'vitest';
import { readingProfile } from './reading-profile.js';

// The hosts recorded in docs/2026-10-19_host-compatibility-observations_v1.md: ChatGPT web,
// Claude web and the Alexa+ web simulator. The record names the products, not the identity each
// reports at initialization, so the names below are the products as they would identify
// themselves; a host that reports something else falls back to the platform the host declares.

describe('the reading profile of a host', () => {
  it.each([
    ['ChatGPT', 'web'],
    ['ChatGPT', undefined],
    ['Claude', 'web'],
    ['Claude', 'desktop'],
  ] as const)('reads %s (platform %s) as a desktop', (hostName, platform) => {
    expect(readingProfile({ platform }, hostName)).toBe('desktop');
  });

  it.each(['Alexa+', 'alexa-plus-simulator', 'Alexa+ Web Simulator'])(
    'reads the Alexa+ host %s as a device whatever platform it declares',
    (hostName) => {
      expect(readingProfile(undefined, hostName)).toBe('device');
      expect(readingProfile({ platform: 'web' }, hostName)).toBe('device');
    },
  );

  // A consumer fixture records the identities a voice-assistant card host has reported: the
  // historical wrapper name as `hostInfo.name`, and a `deviceClass` echo in the host context
  // (an extension field beyond the MCP Apps schema, which the context accepts and passes on).
  it('reads the historical HTMLFragmentWrapper host as a device whatever platform it declares', () => {
    expect(readingProfile(undefined, 'HTMLFragmentWrapper')).toBe('device');
    expect(readingProfile({ platform: 'web' }, 'HTMLFragmentWrapper')).toBe(
      'device',
    );
  });

  it.each(['echo_show', 'echo_show_15', 'echo_show_8', 'amazon_echo_show_5'])(
    'reads the reported device class %s as a device whatever the host is called',
    (deviceClass) => {
      expect(readingProfile({ deviceClass }, undefined)).toBe('device');
      expect(
        readingProfile({ deviceClass, platform: 'web' }, 'Some Host'),
      ).toBe('device');
    },
  );

  it.each(['echo_shower', 'echo_showcase', 'echo', 'shows', '', 'desktop'])(
    'does not read the device class %j as a device',
    (deviceClass) => {
      expect(readingProfile({ deviceClass }, 'Some Host')).toBe('desktop');
    },
  );

  it('ignores a device class that is not a string, and a wrapper name inside another word', () => {
    expect(readingProfile({ deviceClass: 15 }, undefined)).toBe('desktop');
    expect(readingProfile({ deviceClass: ['echo_show'] }, undefined)).toBe(
      'desktop',
    );
    expect(readingProfile(undefined, 'MyHTMLFragmentWrapperish')).toBe(
      'desktop',
    );
  });

  it('reads a host that declares a mobile platform as a device', () => {
    expect(readingProfile({ platform: 'mobile' }, 'ChatGPT')).toBe('device');
    expect(readingProfile({ platform: 'mobile' }, undefined)).toBe('device');
  });

  it('reads an unknown host with no declared platform, or no context at all, as a desktop', () => {
    expect(readingProfile(undefined, undefined)).toBe('desktop');
    expect(readingProfile({}, 'Some Other Host')).toBe('desktop');
  });
});
