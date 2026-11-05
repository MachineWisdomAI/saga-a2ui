import { CLOSED_VIEW_CSP, type ViewCsp } from '../policy/index.js';
import type { OperationView } from './operation.js';
import { viewUriForMajor } from './view-identity.js';

/**
 * Builds the view an operation links its results to from the final HTML text. The address is
 * `viewUriForMajor(filename, major)`: it names the view's compatibility line, not its bytes, so a
 * compatible rebuild (a fix, a restyle, a new build stamp in the document) keeps it and a host
 * holding an earlier tool descriptor still reads a document that is served. Increase `major` only for an
 * incompatible change to what the view reads from a result or what its actions do; every tool that
 * names this view then moves to the new address together. `html` is served verbatim, so a build
 * stamp written into it identifies the build that rendered without affecting the address.
 *
 * A filename that is not a relative `.html` file, or a `major` that is not a safe integer of at
 * least 1, throws `TypeError`.
 *
 * `csp` is structural: any value with some of the host permission fields works, so a package that
 * describes what a document needs (for example the components package's `resourcePermissionsOf`)
 * can supply it without this package importing it. Fields not named stay closed, and fields that
 * are not host permissions are ignored: only the four arrays a host reads reach `_meta.ui.csp`.
 */
export function operationViewFromHtml(settings: {
  readonly html: string;
  readonly filename: string;
  /** Major version of the view's contract. Version 1 is the first line. */
  readonly major: number;
  readonly title: string;
  readonly csp?: Partial<ViewCsp>;
}): OperationView {
  const { csp = {} } = settings;
  return {
    uri: viewUriForMajor(settings.filename, settings.major),
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
