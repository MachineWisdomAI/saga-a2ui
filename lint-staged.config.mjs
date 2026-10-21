// lint-staged owns index updates, backup and restoration of partially staged changes.
export default { '*': 'node scripts/format.mjs --write' };
