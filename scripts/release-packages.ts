import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OwnedDirectory } from './owned-filesystem.js';
import {
  createWorkDirectory,
  packReleasePackages,
  sourceRevision,
} from './packed-consumer.js';

/**
 * Packs the seven release artifacts into `requested` and writes `release.json` beside them. The
 * output directory is created by this run or authenticated as a real directory the user owns (never
 * a link), `packages` below it must be a real directory, and `release.json` replaces its leaf
 * without writing through a link. Preparation only: no registry credentials, upload, tag or
 * publication.
 */
export function prepareReleasePackages(requested: string): {
  readonly output: string;
  readonly source: { readonly commit: string; readonly dirty: boolean };
  readonly packages: ReturnType<typeof packReleasePackages>;
} {
  const output = OwnedDirectory.create(requested);
  const work = createWorkDirectory('saga-release-');
  try {
    const source = sourceRevision();
    const packages = packReleasePackages(work, output.ensureChild('packages'));
    output.writeFile(
      'release.json',
      `${JSON.stringify({ source, packages }, null, 2)}\n`,
    );
    return { output: output.path, source, packages };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { output, source, packages } = prepareReleasePackages(
    path.resolve(process.argv[2] ?? 'release-out'),
  );
  const left = packages.reduce(
    (count, one) => count + one.excludedUntracked.length,
    0,
  );
  console.log(
    `Packed ${packages.length} release artifacts in ${output}; source ${source.commit}${source.dirty ? ' (dirty; rebuild from the reviewed commit)' : ''}${left > 0 ? `; ${left} untracked or ignored file(s) left out (named in release.json)` : ''}. Nothing published.`,
  );
}
