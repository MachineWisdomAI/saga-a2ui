/**
 * Every Content-Security-Policy value the document carries: the restrictions image loading relies
 * on. The application reads them and passes them to `createFaithfulCardView`, which takes no
 * document.
 */
export function documentContentSecurityPolicies(document: Document): string[] {
  return Array.from(
    document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'),
    (meta) => meta.getAttribute('content') ?? '',
  );
}
