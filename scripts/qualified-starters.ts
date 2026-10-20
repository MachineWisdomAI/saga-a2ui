// The starter templates (`templates/<name>`) whose pair CI qualifies from packed artifacts: each is
// built by scripts/build-starter.ts, exercised headless by scripts/starter-qualification.ts and in a
// real browser by apps/lit-host/e2e/starter.spec.ts. A template is added here in the same change
// that adds its evidence, so a pair is never listed before it passes; scripts/starter-template.test.ts
// fails for a template directory that is not listed. This is the qualification inventory only: the
// supported-pair discovery the CLI shows is CLI1's (#26) and reads the templates' own metadata.
//
// The names are plain data on purpose: the browser specification imports this file and must not load
// the build tooling.
export const QUALIFIED_STARTERS = ['lit-node', 'lit-express', 'lit-fastify'] as const;

export type QualifiedStarter = (typeof QUALIFIED_STARTERS)[number];
