import fs from 'node:fs';
import path from 'node:path';
import {
  createWorkDirectory,
  packReleasePackages,
  sourceRevision,
} from './packed-consumer.js';

// Preparation only: no registry credentials, upload, tag or publication.
const output = path.resolve(process.argv[2] ?? 'release-out');
const work = createWorkDirectory('saga-release-');
try {
  const source = sourceRevision();
  const packages = packReleasePackages(work, path.join(output, 'packages'));
  fs.writeFileSync(
    path.join(output, 'release.json'),
    `${JSON.stringify({ source, packages }, null, 2)}\n`,
  );
  console.log(
    `Packed ${packages.length} release artifacts in ${output}; source ${source.commit}${source.dirty ? ' (dirty; rebuild from the reviewed commit)' : ''}. Nothing published.`,
  );
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
