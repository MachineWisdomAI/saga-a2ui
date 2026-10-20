// What the build supplies to the page (scripts/build-tour.ts): the identity of the candidate and
// source it was built from, the lines each quoted source was found at, and the built views.
declare module 'virtual:tour-build' {
  const build: {
    /** The repository commit the page was built from. */
    readonly commit: string;
    /** True when tracked files differed from that commit, so its links may not match what was built. */
    readonly dirty: boolean;
    /** The candidate version of the packed SDK packages the views were built against. */
    readonly candidateVersion: string;
    readonly sources: readonly import('./source-map.js').LocatedSource[];
    /** The built MCP App view of each offered renderer, as the one document a host mounts. */
    readonly views: Readonly<Record<import('./scenarios.js').RendererId, string>>;
  };
  export default build;
}
