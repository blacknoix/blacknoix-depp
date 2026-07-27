import type { Finding } from "./types";

/**
 * After a status mutation, pick the next selection deterministically.
 *
 * - Keep the same finding if it remains in the filtered list.
 * - Otherwise advance to the next pre-mutation neighbor that still exists,
 *   else the previous neighbor, else clear selection.
 *
 * Snooze does not remove findings; callers should keep selection as-is.
 */
export function resolvePostMutationSelection(opts: {
  previousFindings: readonly Finding[];
  previousSelectedId: string | null;
  nextFindings: readonly Finding[];
}): string | null {
  const { previousFindings, previousSelectedId, nextFindings } = opts;
  if (!previousSelectedId) {
    return null;
  }

  if (nextFindings.some((f) => f.id === previousSelectedId)) {
    return previousSelectedId;
  }

  const idx = previousFindings.findIndex((f) => f.id === previousSelectedId);
  if (idx < 0) {
    return nextFindings[0]?.id ?? null;
  }

  for (let i = idx + 1; i < previousFindings.length; i += 1) {
    const candidate = previousFindings[i].id;
    if (nextFindings.some((f) => f.id === candidate)) {
      return candidate;
    }
  }

  for (let i = idx - 1; i >= 0; i -= 1) {
    const candidate = previousFindings[i].id;
    if (nextFindings.some((f) => f.id === candidate)) {
      return candidate;
    }
  }

  return null;
}

export function adjacentFindingId(
  findings: readonly Finding[],
  selectedId: string | null,
  direction: -1 | 1,
): string | null {
  if (!selectedId || findings.length === 0) {
    return null;
  }
  const idx = findings.findIndex((f) => f.id === selectedId);
  if (idx < 0) {
    return null;
  }
  const next = idx + direction;
  if (next < 0 || next >= findings.length) {
    return null;
  }
  return findings[next].id;
}

export function selectionPosition(
  findings: readonly Finding[],
  selectedId: string | null,
): { index: number; total: number } | null {
  if (!selectedId) {
    return null;
  }
  const idx = findings.findIndex((f) => f.id === selectedId);
  if (idx < 0) {
    return null;
  }
  return { index: idx + 1, total: findings.length };
}
