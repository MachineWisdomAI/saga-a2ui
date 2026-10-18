import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import ts from 'typescript';
import { toneWav } from '../src/playback/synthetic-media.js';

// The real Web Audio player in Chromium, exercised through the AudioPlayer interface only. These
// checks record the ordering the playback controller relies on when it releases a retired Play:
// what `stop()` and a following `prepare()` do to a start that is still waiting. They are evidence
// about this player in headless Chromium, not about any assistant host.

const playerSource = new URL('../src/playback/web-audio-player.ts', import.meta.url);

/** Loads the player module from its TypeScript source into a blank page and runs `scenario`. */
async function inPage<T>(page: Page, scenario: string, bytes: readonly number[]): Promise<T> {
  const transpiled = ts.transpileModule(await readFile(playerSource, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Records every context the player creates, so a scenario can hold one back from running.
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const created: AudioContext[] = [];
    (window as unknown as { __contexts: AudioContext[] }).__contexts = created;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args);
        created.push(this);
      }
    };
  });
  await page.goto('/');
  await page.mouse.click(5, 5); // user activation, so the audio context may run
  return page.evaluate(
    async ({ code, scenarioSource, wav }) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const { createWebAudioPlayer } = (await import(/* @vite-ignore */ url)) as {
        createWebAudioPlayer(): {
          prepare(): void;
          start(bytes: ArrayBuffer): Promise<'started' | 'blocked'>;
          stop(): void;
        };
      };
      const fresh = () => new Uint8Array(wav).buffer;
      const settle = (promise: Promise<unknown>) =>
        promise.then(
          (value) => `resolved:${String(value)}`,
          (error: unknown) => `rejected:${error instanceof Error ? error.message : String(error)}`,
        );
      const run = new Function('createWebAudioPlayer', 'fresh', 'settle', `return (async () => { ${scenarioSource} })();`);
      return run(createWebAudioPlayer, fresh, settle);
    },
    { code: transpiled, scenarioSource: scenario, wav: bytes },
  ) as Promise<T>;
}

const WAV = [...toneWav(1)];

test.describe('the real Web Audio player and a start that is still waiting', () => {
  test('stop() while a start is decoding or waiting for the clock rejects that start', async ({ page }) => {
    const outcome = await inPage<string[]>(
      page,
      `
        const player = createWebAudioPlayer();
        player.prepare();
        const decoding = settle(player.start(fresh()));
        player.stop(); // before the decode has finished
        player.prepare();
        await window.__contexts[1].suspend(); // the audio clock cannot advance
        const waiting = settle(player.start(fresh()));
        await new Promise((resolve) => setTimeout(resolve, 150)); // decoded, source started, clock polling
        player.stop();
        return [await decoding, await waiting];
      `,
      WAV,
    );
    expect(outcome).toEqual(['rejected:stopped', 'rejected:stopped']);
  });

  test('a start belonging to an earlier prepare() is rejected by the next prepare() and cannot end the newer start', async ({ page }) => {
    const outcome = await inPage<{ older: string; newer: string }>(
      page,
      `
        const player = createWebAudioPlayer();
        player.prepare();
        await window.__contexts[0].suspend(); // the older start waits on a clock that does not advance
        const older = settle(player.start(fresh()));
        await new Promise((resolve) => setTimeout(resolve, 150));
        player.prepare(); // a later Play takes the player over, releasing the earlier context
        const newer = settle(player.start(fresh()));
        const result = { older: await older, newer: await newer };
        player.stop();
        return result;
      `,
      WAV,
    );
    expect(outcome.older).toBe('rejected:stopped');
    expect(outcome.newer).toMatch(/^resolved:(started|blocked)$/);
  });
});
