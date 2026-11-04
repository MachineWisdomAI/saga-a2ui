/**
 * Freezes a value and everything reachable from it, and returns it. Iterative, so the depth of
 * the value costs no stack; callers that take untrusted values admit them first (see
 * `admission.ts`), which also bounds the work.
 */
export function deepFreeze<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (
      typeof current !== 'object' ||
      current === null ||
      Object.isFrozen(current)
    )
      continue;
    Object.freeze(current);
    for (const child of Object.values(current)) pending.push(child);
  }
  return value;
}
