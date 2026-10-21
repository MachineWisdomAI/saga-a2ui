import { vi } from 'vitest';

/**
 * Test helper: everything the process writes through the ordinary log channels while a request
 * runs. Tests assert that no capability, credential or backend text appears in it.
 */
export function captureOrdinaryLogs(): {
  readonly text: () => string;
  readonly restore: () => void;
} {
  const lines: string[] = [];
  const record = (...parts: unknown[]) =>
    void lines.push(parts.map(String).join(' '));
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
    (method) => vi.spyOn(console, method).mockImplementation(record),
  );
  const out = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk) => (record(chunk), true));
  const err = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk) => (record(chunk), true));
  return {
    text: () => lines.join('\n'),
    restore: () => [...spies, out, err].forEach((spy) => spy.mockRestore()),
  };
}
