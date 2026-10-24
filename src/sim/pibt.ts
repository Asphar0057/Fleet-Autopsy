// PIBT move planner (Okumura et al.), ported from docs/reference/pibt_reference.py.
// One `plan` call decides every robot's next cell for one tick. All scratch
// arrays are allocated once in `createPlanner`; `plan` allocates nothing.

import type { DistanceCache } from './distance';
import type { Layout } from './layout';
import { CellKind } from './types';

export interface PlanInput {
  n: number;
  pos: Int16Array;
  goal: Int16Array;
  prio: Int32Array; // effective priority, higher first
  pinned: Uint8Array; // 1 = serving: stays and cannot be pushed (rule c)
  allowAccess: Int16Array; // access cell for this robot's distance map, or -1
  holds: Int16Array; // station index this robot holds, or -1
  tieRot: Uint8Array; // 0..4 rotation of the candidate list
}

export interface Planner {
  /** Writes each robot's next cell into `out[0..n)`. */
  plan(input: PlanInput, out: Int16Array): void;
}

/** Candidates per robot: 4 neighbors (E, W, S, N) plus staying. */
const SLOTS = 5;

export function createPlanner(layout: Layout, cache: DistanceCache, maxRobots: number): Planner {
  const { kinds, neighbors, accessOf, access } = layout;
  const cells = kinds.length;

  const occ = new Int16Array(cells); // robot id per cell, -1 if empty
  const claimed = new Uint8Array(cells); // 1 once a robot will end the tick on the cell
  const order = new Int16Array(maxRobots);
  const decided = new Uint8Array(maxRobots); // 1 once out[i] is set (tentative while exploring)
  // One candidate buffer per recursion depth; depth never exceeds the robot count.
  const cand = new Int16Array(SLOTS * maxRobots);
  const candDist = new Int16Array(SLOTS * maxRobots);

  /** Movement filter: walls never; access cells only for the holder; endpoints only as goal. */
  function allowed(inp: PlanInput, i: number, c: number): boolean {
    const k = kinds[c];
    if (k === CellKind.Wall) return false;
    if (c === inp.pos[i]) return true;
    if (accessOf[c] >= 0) {
      const h = inp.holds[i];
      if (h < 0 || access[h] !== c) return false;
    }
    if (k !== CellKind.Floor && c !== inp.goal[i]) return false;
    return true;
  }

  /**
   * Plans robot `i`, pushed by `parent` (-1 at top level). Returns false if `i`
   * had to stay. On a child's failure the cell stays claimed: the child now
   * stays on it, so freeing it would let a third robot collide with the child.
   */
  function pibt(inp: PlanInput, out: Int16Array, i: number, parent: number, depth: number): boolean {
    const { pos, goal } = inp;
    const here = pos[i];
    const dist = cache.get(goal[i], inp.allowAccess[i]);
    const base = depth * SLOTS;

    // Build the rotated candidate list, filtered, then stable insertion sort by distance.
    const rot = inp.tieRot[i] % SLOTS;
    let m = 0;
    for (let k = 0; k < SLOTS; k++) {
      const slot = (k + rot) % SLOTS;
      const c = slot === 4 ? here : neighbors[here * 4 + slot];
      if (c < 0 || !allowed(inp, i, c)) continue;
      const d = dist[c];
      let j = m;
      while (j > 0 && candDist[base + j - 1] > d) {
        cand[base + j] = cand[base + j - 1];
        candDist[base + j] = candDist[base + j - 1];
        j--;
      }
      cand[base + j] = c;
      candDist[base + j] = d;
      m++;
    }

    const parentCell = parent >= 0 ? pos[parent] : -1;
    for (let k = 0; k < m; k++) {
      const c = cand[base + k];
      if (claimed[c] === 1 || c === parentCell) continue;
      const j = occ[c];
      // Swap: the occupant already decided to move into our cell.
      if (j >= 0 && j !== i && decided[j] === 1 && out[j] === here) continue;
      claimed[c] = 1;
      out[i] = c;
      decided[i] = 1;
      if (j >= 0 && j !== i && decided[j] === 0) {
        if (!pibt(inp, out, j, i, depth + 1)) {
          // j stays on c; c remains claimed by j. Try our next candidate.
          decided[i] = 0;
          continue;
        }
      }
      return true;
    }

    // Nothing works: stay. Our cell can only be claimed already by `parent`
    // (claiming an occupied cell always recurses into its undecided occupant);
    // that claim now means we stay here, and the parent moves on to its next candidate.
    out[i] = here;
    decided[i] = 1;
    claimed[here] = 1;
    return false;
  }

  return {
    plan(inp: PlanInput, out: Int16Array): void {
      const { n, pos, prio, pinned } = inp;
      if (n > maxRobots) throw new RangeError(`plan: ${n} robots exceeds maxRobots ${maxRobots}`);
      occ.fill(-1);
      claimed.fill(0);
      decided.fill(0, 0, n);
      for (let i = 0; i < n; i++) occ[pos[i]] = i;

      // Pinned robots (serving) claim their cells before anyone plans (rule c).
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (pinned[i] === 1) {
          out[i] = pos[i];
          decided[i] = 1;
          claimed[pos[i]] = 1;
          continue;
        }
        // Insertion sort by (-prio, id): ids arrive ascending, so strict > keeps ties by id.
        let j = count;
        while (j > 0 && prio[order[j - 1]] < prio[i]) {
          order[j] = order[j - 1];
          j--;
        }
        order[j] = i;
        count++;
      }

      for (let k = 0; k < count; k++) {
        const i = order[k];
        if (decided[i] === 0) pibt(inp, out, i, -1, 0);
      }
    },
  };
}
