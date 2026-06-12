/**
 * Pure JSON helpers shared by engines. NO `server-only` import — engines stay
 * isomorphic (importable from scripts/tests/client-safe code); only the provider
 * + runEngine orchestration layer is server-bound.
 */
export function parseJsonLoose<T>(raw: string): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}
