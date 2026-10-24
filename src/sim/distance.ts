// Blocked-aware BFS distance cache (rule a). Each instance owns its maps and
// queue; nothing is module-level mutable state. See design.md D8.

import type { Layout } from './layout';
import { CellKind } from './types';

/** Distance of an unreachable cell. Fits Int16. */
export const INF = 32767;

export interface DistanceCache {
  /**
   * BFS distances toward `goal`. Station Access_Cells are blocked except
   * `allowAccess` (-1 allows none). The returned array is cached and shared:
   * callers must not mutate it.
   */
  get(goal: number, allowAccess: number): Int16Array;
  /**
   * Engaged blocked cells (Spec 2 D10): BFS skips cells with mask[c] === 1.
   * Increments the version and drops every cached map. The cache keeps a
   * reference to `mask`; call setBlocked again whenever its contents change.
   */
  setBlocked(mask: Uint8Array): void;
}

export function createDistanceCache(layout: Layout): DistanceCache {
  const { kinds, neighbors, accessOf } = layout;
  const cells = kinds.length;
  const maps = new Map<number, Int16Array>();
  // Each cell enters the queue at most once, so `cells` slots suffice.
  const queue = new Int16Array(cells);
  // Versioned key (D10): version * K + goal * (cells + 1) + allowAccess + 1.
  // Version 0 with no mask is the Spec 1 key. setBlocked runs at most twice per
  // blocked-cell fault, so version * K stays far below 2^53.
  const K = (cells + 1) * (cells + 1);
  let version = 0;
  let blocked: Uint8Array | null = null;

  function compute(goal: number, allowAccess: number): Int16Array {
    const dist = new Int16Array(cells).fill(INF);
    let head = 0;
    let tail = 0;
    dist[goal] = 0;
    queue[tail++] = goal;
    while (head < tail) {
      const c = queue[head++];
      const next = dist[c] + 1;
      for (let d = 0; d < 4; d++) {
        const n = neighbors[c * 4 + d];
        if (n < 0 || dist[n] !== INF) continue;
        if (kinds[n] !== CellKind.Floor) continue;
        if (accessOf[n] >= 0 && n !== allowAccess) continue;
        if (blocked !== null && blocked[n] === 1) continue;
        dist[n] = next;
        queue[tail++] = n;
      }
    }
    return dist;
  }

  return {
    get(goal: number, allowAccess: number): Int16Array {
      const key = version * K + goal * (cells + 1) + allowAccess + 1;
      let m = maps.get(key);
      if (m === undefined) {
        m = compute(goal, allowAccess);
        maps.set(key, m);
      }
      return m;
    },
    setBlocked(mask: Uint8Array): void {
      if (mask.length !== cells) throw new RangeError(`setBlocked: mask has ${mask.length} cells, layout has ${cells}`);
      blocked = mask;
      version++;
      maps.clear();
    },
  };
}
