// Simulation tick loop: task cycle, admission, station reservation, PIBT
// planning, recording, and stall events. Movement and station rules follow
// docs/reference/pibt_reference.py and keep its tick order (design.md).
// Each Sim owns all of its state in typed arrays sized at creation.

import { createDistanceCache } from './distance';
import { createFaultState, validateFaults } from './faults';
import type { Layout } from './layout';
import { createPlanner } from './pibt';
import type { PlanInput } from './pibt';
import { createRecorder } from './recorder';
import type { Recording } from './recorder';
import { mulberry32, randInt } from './rng';
import { CellKind, EKind, RState } from './types';
import type { SimConfig } from './types';

export interface Sim {
  readonly layout: Layout;
  readonly config: SimConfig;
  readonly recording: Recording;
  /** Completed ticks; recording.frames === tick + 1. */
  readonly tick: number;
  step(): void;
  run(ticks: number): void;
}

/** Ticks without a move before a stall event fires (Requirement 5.4). */
export const STALL_TICKS = 200;

/** Admission weight per queued or pending robot in station choice (Requirement 4.1). */
const QUEUE_WEIGHT = 3;

/**
 * True when a stall event is due (D17): the robot is in to-pod, to-station,
 * or returning, has not moved for STALL_TICKS ticks, and has not fired yet
 * for this standstill.
 */
export function stallDue(tick: number, lastMove: number, state: number, fired: number): boolean {
  if (fired !== 0) return false;
  if (state !== RState.ToPod && state !== RState.ToStation && state !== RState.Returning) return false;
  return tick - lastMove >= STALL_TICKS;
}

/**
 * Effective planning priority (rule b): idle = -2, to-station without the
 * reservation = -1, everyone else = age (>= 0).
 */
export function effectivePriority(state: number, holdsReservation: boolean, age: number): number {
  if (state === RState.Idle) return -2;
  if (state === RState.ToStation && !holdsReservation) return -1;
  return age;
}

/**
 * The queued robot with minimum (accessDist[pos[r]], id), or -1 if the queue is
 * empty. Reads queue[offset .. offset + qCount). The sim passes
 * accessDist = cache.get(access[s], access[s]) (D18).
 */
export function pickHolder(
  queue: Int16Array,
  qCount: number,
  pos: Int16Array,
  accessDist: Int16Array,
  offset = 0,
): number {
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < qCount; k++) {
    const r = queue[offset + k];
    const d = accessDist[pos[r]];
    if (best < 0 || d < bestD || (d === bestD && r < best)) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

export function createSim(layout: Layout, config: SimConfig): Sim {
  const n = config.robots;
  const { pods, stations, access, kinds, neighbors } = layout;
  const S = stations.length;

  // Spawn candidates: floor cells that are not station Access_Cells (D2).
  const spawnCells: number[] = [];
  for (let k = 0; k < layout.floor.length; k++) {
    const c = layout.floor[k];
    if (layout.accessOf[c] < 0) spawnCells.push(c);
  }

  if (!Number.isInteger(n) || n < 1) throw new Error(`createSim: robots must be an integer >= 1, got ${n}`);
  if (n >= pods.length) {
    throw new Error(`createSim: robots (${n}) must be fewer than pods (${pods.length}) on ${layout.id}`);
  }
  if (n > layout.floor.length - S || n > spawnCells.length) {
    throw new Error(`createSim: robots (${n}) exceed free floor cells on ${layout.id}`);
  }
  if (!Number.isInteger(config.queueCap) || config.queueCap < 1) {
    throw new Error(`createSim: queueCap must be an integer >= 1, got ${config.queueCap}`);
  }
  if (S < 1) throw new Error(`createSim: layout ${layout.id} has no stations`);
  // Field ranges and the D8 blocked-cell union check; throws before any PRNG draw.
  validateFaults(layout, n, config.faults);

  const rng = mulberry32(config.seed);
  const cache = createDistanceCache(layout);
  const planner = createPlanner(layout, cache, n);
  const recorder = createRecorder(n, S);
  const queueCap = config.queueCap;
  // Fault effects (Spec 2). Every fault path is gated on hasFaults so a
  // fault-free run executes exactly the Spec 1 draws and decisions.
  const hasFaults = config.faults.length > 0;
  const fs = createFaultState(layout, n, config.faults);
  const frozen = fs.frozen;
  const slowPin = fs.slowPin;
  const factor = fs.factor;

  // Per robot.
  const pos = new Int16Array(n);
  const goal = new Int16Array(n);
  const state = new Uint8Array(n); // RState
  const home = new Int16Array(n).fill(-1); // reserved pod slot
  const stn = new Int16Array(n).fill(-1); // target station of the current task
  const timer = new Int16Array(n);
  const age = new Int32Array(n);
  const taskStart = new Int32Array(n);
  const lastMove = new Int32Array(n);
  const stallFired = new Uint8Array(n);
  const holding = new Int16Array(n).fill(-1); // station whose reservation this robot holds
  // Per station.
  const holder = new Int16Array(S).fill(-1);
  const pending = new Int16Array(S);
  const qCount = new Uint8Array(S); // also the recorded queue length (D7)
  const queue = new Int16Array(S * n); // unordered list per station (D15)
  // Per cell.
  const podReserved = new Uint8Array(kinds.length);

  // Planner input, reused every tick. pos, goal, and holds alias sim state.
  const inp: PlanInput = {
    n,
    pos,
    goal,
    prio: new Int32Array(n),
    pinned: new Uint8Array(n),
    allowAccess: new Int16Array(n).fill(-1),
    holds: holding,
    tieRot: new Uint8Array(n),
  };
  const out = new Int16Array(n);

  // Seeded spawn: partial Fisher-Yates over the candidate cells.
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (spawnCells.length - i));
    const t = spawnCells[i];
    spawnCells[i] = spawnCells[j];
    spawnCells[j] = t;
    pos[i] = spawnCells[i];
    goal[i] = pos[i];
    state[i] = RState.Idle;
  }
  recorder.pushFrame(pos, goal, state, qCount);

  let tick = 0;

  /** Station score for a pod: min over its floor neighbors of the station distance, plus queue load. */
  function stationScore(s: number, pod: number): number {
    const dm = cache.get(stations[s], access[s]);
    let best = Number.MAX_SAFE_INTEGER;
    for (let d = 0; d < 4; d++) {
      const c = neighbors[pod * 4 + d];
      if (c >= 0 && kinds[c] === CellKind.Floor && dm[c] < best) best = dm[c];
    }
    return best + QUEUE_WEIGHT * (qCount[s] + pending[s]);
  }

  /** Task selection with admission (Requirement 4.1, 4.2). */
  function tryTask(i: number, t: number): void {
    const wasIdle = state[i] === RState.Idle;
    let anyRoom = false;
    for (let s = 0; s < S; s++) {
      if (qCount[s] + pending[s] < queueCap) {
        anyRoom = true;
        break;
      }
    }
    if (!anyRoom) {
      state[i] = RState.Idle;
      goal[i] = pos[i];
      return;
    }
    // D16: draw until an unreserved pod; terminates because robots < pods.
    let p = pods[Math.floor(rng() * pods.length)];
    while (podReserved[p] === 1) p = pods[Math.floor(rng() * pods.length)];
    podReserved[p] = 1;
    home[i] = p;
    let best = -1;
    let bestScore = 0;
    for (let s = 0; s < S; s++) {
      if (qCount[s] + pending[s] >= queueCap) continue;
      const sc = stationScore(s, p);
      if (best < 0 || sc < bestScore) {
        best = s;
        bestScore = sc;
      }
    }
    stn[i] = best;
    pending[best]++;
    goal[i] = p;
    state[i] = RState.ToPod;
    taskStart[i] = t;
    if (wasIdle) {
      // The standstill clock starts when the robot leaves admission wait.
      lastMove[i] = t;
      stallFired[i] = 0;
    }
  }

  function removeFromQueue(s: number, r: number): void {
    const base = s * n;
    const c = qCount[s];
    for (let k = 0; k < c; k++) {
      if (queue[base + k] === r) {
        queue[base + k] = queue[base + c - 1];
        qCount[s] = c - 1;
        return;
      }
    }
  }

  function step(): void {
    // Events carry the index of the frame this step produces.
    const t = tick + 1;

    // 0. Faults active in frame t (skipped entirely when there are none).
    if (hasFaults) fs.update(t, pos);

    // 1. Task phase, robots in id order. A frozen robot skips it entirely (D3).
    for (let i = 0; i < n; i++) {
      if (hasFaults && frozen[i] === 1) continue;
      const st = state[i];
      if (st === RState.Idle) {
        tryTask(i, t);
        continue;
      }
      if (st === RState.Serving) {
        timer[i]--;
        if (timer[i] <= 0) {
          recorder.pushEvent(t, i, EKind.ServiceEnd, taskStart[i]);
          state[i] = RState.Returning;
          goal[i] = home[i];
          age[i] = 0;
          lastMove[i] = t; // serving time does not count toward a stall
          stallFired[i] = 0;
        }
        continue;
      }
      if (pos[i] !== goal[i]) continue;
      age[i] = 0;
      if (st === RState.ToPod) {
        const s = stn[i];
        recorder.pushEvent(t, i, EKind.Pick, home[i]);
        pending[s]--;
        queue[s * n + qCount[s]] = i;
        qCount[s]++;
        state[i] = RState.ToStation;
        goal[i] = stations[s];
      } else if (st === RState.ToStation) {
        recorder.pushEvent(t, i, EKind.ServiceStart, stn[i]);
        state[i] = RState.Serving;
        timer[i] = randInt(rng, 8, 14);
        // Station slowdown scales only services starting now (D6); one draw as in Spec 1.
        if (hasFaults) timer[i] *= factor[stn[i]];
      } else if (st === RState.Returning) {
        recorder.pushEvent(t, i, EKind.Deliver, home[i]);
        podReserved[home[i]] = 0;
        tryTask(i, t);
      }
    }

    // 2. Release, robots in id order: a departed holder off both cells frees the station.
    for (let i = 0; i < n; i++) {
      const s = holding[i];
      if (s < 0) continue;
      const st = state[i];
      if (st === RState.ToStation || st === RState.Serving) continue;
      if (pos[i] === stations[s] || pos[i] === access[s]) continue;
      removeFromQueue(s, i);
      holder[s] = -1;
      holding[i] = -1;
    }

    // 3. Assign, stations in index order (D18).
    for (let s = 0; s < S; s++) {
      if (holder[s] >= 0 || qCount[s] === 0) continue;
      const r = pickHolder(queue, qCount[s], pos, cache.get(access[s], access[s]), s * n);
      holder[s] = r;
      holding[r] = s;
    }

    // 4. Plan.
    for (let i = 0; i < n; i++) {
      const st = state[i];
      inp.pinned[i] = st === RState.Serving || (hasFaults && (frozen[i] === 1 || slowPin[i] === 1)) ? 1 : 0;
      inp.prio[i] = effectivePriority(st, holding[i] >= 0, age[i]);
      inp.allowAccess[i] =
        st === RState.ToStation || st === RState.Serving || st === RState.Returning ? access[stn[i]] : -1;
      // One draw per non-serving robot per tick (D3), whether pinned by a fault or not (Spec 2 D5).
      inp.tieRot[i] = st === RState.Serving ? 0 : Math.floor(rng() * 5);
    }
    planner.plan(inp, out);

    // 5. Apply, record, stalls.
    for (let i = 0; i < n; i++) {
      if (out[i] !== pos[i]) {
        pos[i] = out[i];
        lastMove[i] = t;
        stallFired[i] = 0;
      }
      const st = state[i];
      // A frozen robot's age does not grow (D3).
      if (st !== RState.Serving && st !== RState.Idle && !(hasFaults && frozen[i] === 1)) age[i]++;
      if (stallDue(t, lastMove[i], st, stallFired[i])) {
        recorder.pushEvent(t, i, EKind.Stall, pos[i]);
        stallFired[i] = 1;
      }
    }
    recorder.pushFrame(pos, goal, state, qCount);
    tick = t;
  }

  return {
    layout,
    config,
    get recording() {
      return recorder.recording;
    },
    get tick() {
      return tick;
    },
    step,
    run(ticks: number) {
      for (let k = 0; k < ticks; k++) step();
    },
  };
}
