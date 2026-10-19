// Where the specs read the built pages from. By default that is `dist`, built from the workspace by
// `npm run build`. `SAGA_BUILT_DIR=dist-installed` selects the build made outside the repository
// from the packed SDK packages (scripts/build-installed-lit-host.ts, `npm run test:browser:installed`),
// so the same specs qualify either build. playwright.config.ts serves the same directory.

const BUILT_DIRECTORIES = ['dist', 'dist-installed'] as const;

export type BuiltDirectory = (typeof BUILT_DIRECTORIES)[number];

export function builtDirectory(env: Record<string, string | undefined> = process.env): BuiltDirectory {
  const requested = env.SAGA_BUILT_DIR ?? 'dist';
  const found = BUILT_DIRECTORIES.find((name) => name === requested);
  if (found === undefined) throw new Error(`SAGA_BUILT_DIR must be one of ${BUILT_DIRECTORIES.join(', ')}, not ${requested}`);
  return found;
}

/** The URL of a file in the selected build, for example `builtUrl('view/view.html')`. */
export function builtUrl(relativePath: string): URL {
  return new URL(`../${builtDirectory()}/${relativePath}`, import.meta.url);
}
