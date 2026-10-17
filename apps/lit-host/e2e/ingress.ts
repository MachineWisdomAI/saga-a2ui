import type { Page } from '@playwright/test';
import type { IngestResult } from '@saga-a2ui/core/protocols/a2ui/v0_9';

/** Send unchecked input through the page's declared `window.sagaSend` entry point. */
export function sagaSend(page: Page, input: unknown): Promise<IngestResult | undefined> {
  return page.evaluate((payload) => window.sagaSend?.(payload), input);
}
