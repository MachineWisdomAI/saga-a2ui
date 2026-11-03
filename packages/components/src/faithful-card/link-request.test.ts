import { describe, expect, it } from 'vitest';
import { requestLinkOpen } from './link-request.js';

describe('requesting that the host open a link', () => {
  it('reports the host’s own answer', async () => {
    const asked: string[] = [];
    const outcome = await requestLinkOpen(
      {
        open: (url) => {
          asked.push(url);
          return Promise.resolve('denied');
        },
      },
      'https://docs.example.com/guide',
    );
    expect(outcome).toBe('denied');
    expect(asked).toEqual(['https://docs.example.com/guide']);
  });

  it('reports failed, and never rejects, when the adapter rejects or throws', async () => {
    await expect(
      requestLinkOpen(
        { open: () => Promise.reject(new Error('host adapter failed')) },
        'https://docs.example.com/',
      ),
    ).resolves.toBe('failed');
    await expect(
      requestLinkOpen(
        {
          open: () => {
            throw new Error('synchronous failure');
          },
        },
        'https://docs.example.com/',
      ),
    ).resolves.toBe('failed');
  });
});
