import { CLOSED_VIEW_CSP, type ViewCsp } from '../policy/index.js';
import type { OperationView } from './operation.js';
import { viewUriForHtml } from './view-identity.js';

/**
 * Builds the view an operation links its results to from the final HTML text. The identity is
 * `viewUriForHtml` of exactly `html` under `filename`, so apply this after every build, inlining
 * and stamping step; a filename that is not a relative `.html` file throws as `viewUriForHtml`
 * does.
 *
 * `csp` is structural: any value with some of the host permission fields works, so a package that
 * describes what a document needs (for example the components package's `resourcePermissionsOf`)
 * can supply it without this package importing it. Fields not named stay closed, and fields that
 * are not host permissions are ignored: only the four arrays a host reads reach `_meta.ui.csp`.
 */
export function operationViewFromHtml(settings: {
  readonly html: string;
  readonly filename: string;
  readonly title: string;
  readonly csp?: Partial<ViewCsp>;
}): OperationView {
  const { csp = {} } = settings;
  return {
    uri: viewUriForHtml(settings.html, settings.filename),
    title: settings.title,
    html: settings.html,
    csp: {
      connectDomains: [
        ...(csp.connectDomains ?? CLOSED_VIEW_CSP.connectDomains),
      ],
      resourceDomains: [
        ...(csp.resourceDomains ?? CLOSED_VIEW_CSP.resourceDomains),
      ],
      frameDomains: [...(csp.frameDomains ?? CLOSED_VIEW_CSP.frameDomains)],
      baseUriDomains: [
        ...(csp.baseUriDomains ?? CLOSED_VIEW_CSP.baseUriDomains),
      ],
    },
  };
}
