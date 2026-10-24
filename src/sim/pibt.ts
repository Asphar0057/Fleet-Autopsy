// PIBT move planner (Okumura et al.), ported from docs/reference/pibt_reference.py.
// Extended with the swap operation from LaCAM* (Okumura 2024) and a pushed-robot
// tie-break, so corridor head-ons resolve regardless of tieRot or ids.
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
  const candPush = new Int16Array(SLOTS * maxRobots); // pusher's distance, tie-break for a pushed robot

  // Corridor graph for the swap check: plain floor cells (no endpoints, no access cells).
  const trav = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) trav[c] = kinds[c] === CellKind.Floor && accessOf[c] < 0 ? 1 : 0;
  const deg = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) {
    for (let d = 0; d < 4; d++) {
      const u = neighbors[c * 4 + d];
      if (u >= 0 && trav[u] === 1) deg[c]++;
    }
  }

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

  // ---- Swap operation (Okumura, "Engineering LaCAM*", 2024: PIBT with swap). ----
  // Plain PIBT is incomplete on trees: in a corridor, a higher-priority robot can
  // push a lower one into a dead end and both stay forever. With swap, the higher
  // robot retreats toward a branch cell, pulling the other into its old cell, so
  // the two can pass at the branch.

  const BRANCH = -1;
  const DEAD = -2;

  /** A dead-end cell holding a robot that sits on its goal acts like a wall. */
  function goalSitter(inp: PlanInput, u: number): boolean {
    const a = occ[u];
    return deg[u] === 1 && a >= 0 && inp.goal[a] === u;
  }

  /** One step of the corridor walk: BRANCH, DEAD, or the single onward cell. */
  function walk(inp: PlanInput, from: number, at: number): number {
    let n = 0;
    let next = -1;
    for (let d = 0; d < 4; d++) {
      const u = neighbors[at * 4 + d];
      if (u < 0 || trav[u] === 0 || u === from || goalSitter(inp, u)) continue;
      n++;
      next = u;
    }
    if (n >= 2) return BRANCH;
    if (n === 0) return DEAD;
    return next;
  }

  /** True if `pusher` (at vPusher) and `puller` (at vPuller) must swap: no branch ahead of the puller. */
  function swapRequired(inp: PlanInput, pusher: number, puller: number, vPusher: number, vPuller: number): boolean {
    const dp = cache.get(inp.goal[pusher], inp.allowAccess[pusher]);
    const dq = cache.get(inp.goal[puller], inp.allowAccess[puller]);
    for (let guard = cells; dp[vPuller] < dp[vPusher] && guard > 0; guard--) {
      const t = walk(inp, vPusher, vPuller);
      if (t === BRANCH) return false;
      if (t === DEAD) break;
      vPusher = vPuller;
      vPuller = t;
    }
    return dq[vPusher] < dq[vPuller] && (dp[vPusher] === 0 || dp[vPuller] < dp[vPusher]);
  }

  /** True if retreating from vPullerOrigin (away from vPusherOrigin) reaches a branch cell. */
  function swapPossible(inp: PlanInput, vPusherOrigin: number, vPullerOrigin: number): boolean {
    let vPusher = vPusherOrigin;
    let vPuller = vPullerOrigin;
    for (let guard = cells; vPuller !== vPusherOrigin && guard > 0; guard--) {
      const t = walk(inp, vPusher, vPuller);
      if (t === BRANCH) return true;
      if (t === DEAD) return false;
      vPusher = vPuller;
      vPuller = t;
    }
    return false;
  }

  /** The robot `i` should pull while retreating, or -1. `best` is i's top candidate. */
  function swapAgent(inp: PlanInput, i: number, best: number): number {
    const here = inp.pos[i];
    if (best === here) return -1;
    // Case a: the robot in front must pass us.
    const j = occ[best];
    if (j >= 0 && decided[j] === 0 && swapRequired(inp, i, j, here, best) && swapPossible(inp, best, here)) return j;
    // Case c: clear the way for a neighbor that must pass us.
    for (let d = 0; d < 4; d++) {
      const u = neighbors[here * 4 + d];
      if (u < 0 || u === best) continue;
      const k = occ[u];
      if (k < 0) continue;
      if (swapRequired(inp, k, i, here, best) && swapPossible(inp, best, here)) return k;
    }
    return -1;
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

    // Build the rotated candidate list, filtered, then stable insertion sort by
    // (distance asc, pusher's distance desc). The second key makes a pushed robot
    // step out of the pusher's way (e.g. into a side pocket, not down the pusher's
    // dead-end goal aisle). At top level it is constant, so ties fall to tieRot.
    const pushDist = parent >= 0 ? cache.get(goal[parent], inp.allowAccess[parent]) : null;
    const rot = inp.tieRot[i] % SLOTS;
    let m = 0;
    for (let k = 0; k < SLOTS; k++) {
      const slot = (k + rot) % SLOTS;
      const c = slot === 4 ? here : neighbors[here * 4 + slot];
      if (c < 0 || !allowed(inp, i, c)) continue;
      const d = dist[c];
      const pd = pushDist === null ? 0 : pushDist[c];
      let j = m;
      while (
        j > 0 &&
        (candDist[base + j - 1] > d || (candDist[base + j - 1] === d && candPush[base + j - 1] < pd))
      ) {
        cand[base + j] = cand[base + j - 1];
        candDist[base + j] = candDist[base + j - 1];
        candPush[base + j] = candPush[base + j - 1];
        j--;
      }
      cand[base + j] = c;
      candDist[base + j] = d;
      candPush[base + j] = pd;
      m++;
    }

    // Swap: retreat (reverse the candidate order) and pull the swap robot behind us.
    const swap = m > 0 ? swapAgent(inp, i, cand[base]) : -1;
    if (swap >= 0) {
      for (let a = base, b = base + m - 1; a < b; a++, b--) {
        const t = cand[a];
        cand[a] = cand[b];
        cand[b] = t;
      }
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
      // Pull the swap robot into our old cell when we took the retreat move.
      if (
        k === 0 &&
        swap >= 0 &&
        decided[swap] === 0 &&
        claimed[here] === 0 &&
        c !== pos[swap] &&
        allowed(inp, swap, here)
      ) {
        out[swap] = here;
        decided[swap] = 1;
        claimed[here] = 1;
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
