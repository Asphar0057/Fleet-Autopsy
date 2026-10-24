// Recorder: per-frame robot cells, goals, states, and station queue lengths,
// plus an event list. Buffers grow by doubling (amortized). Views returned by
// positionsAt / statesAt stay valid until the next growth; read them immediately.

export interface Recording {
  readonly robots: number;
  readonly stations: number;
  frames: number;
  positions: Int16Array; // frames x robots, tick-major
  goals: Int16Array; // frames x robots: goal used to plan the move into that frame (D4)
  states: Uint8Array; // frames x robots
  queueLen: Uint8Array; // frames x stations
  evTick: Int32Array;
  evRobot: Int16Array;
  evKind: Uint8Array;
  evArg: Int32Array; // see design.md D6
  events: number;
}

export interface Recorder {
  readonly recording: Recording;
  pushFrame(pos: Int16Array, goal: Int16Array, state: Uint8Array, queueLen: Uint8Array): void;
  pushEvent(tick: number, robot: number, kind: number, arg: number): void;
}

const INITIAL_FRAMES = 256;
const INITIAL_EVENTS = 256;

function grow<T extends Int16Array | Int32Array | Uint8Array>(a: T, size: number): T {
  const b = new (a.constructor as new (n: number) => T)(size);
  b.set(a);
  return b;
}

export function createRecorder(robots: number, stations: number): Recorder {
  let frameCap = INITIAL_FRAMES;
  let eventCap = INITIAL_EVENTS;
  const rec: Recording = {
    robots,
    stations,
    frames: 0,
    positions: new Int16Array(frameCap * robots),
    goals: new Int16Array(frameCap * robots),
    states: new Uint8Array(frameCap * robots),
    queueLen: new Uint8Array(frameCap * stations),
    evTick: new Int32Array(eventCap),
    evRobot: new Int16Array(eventCap),
    evKind: new Uint8Array(eventCap),
    evArg: new Int32Array(eventCap),
    events: 0,
  };

  return {
    recording: rec,
    pushFrame(pos, goal, state, queueLen) {
      if (rec.frames === frameCap) {
        frameCap *= 2;
        rec.positions = grow(rec.positions, frameCap * robots);
        rec.goals = grow(rec.goals, frameCap * robots);
        rec.states = grow(rec.states, frameCap * robots);
        rec.queueLen = grow(rec.queueLen, frameCap * stations);
      }
      const o = rec.frames * robots;
      for (let i = 0; i < robots; i++) {
        rec.positions[o + i] = pos[i];
        rec.goals[o + i] = goal[i];
        rec.states[o + i] = state[i];
      }
      const q = rec.frames * stations;
      for (let s = 0; s < stations; s++) rec.queueLen[q + s] = queueLen[s];
      rec.frames++;
    },
    pushEvent(tick, robot, kind, arg) {
      if (rec.events === eventCap) {
        eventCap *= 2;
        rec.evTick = grow(rec.evTick, eventCap);
        rec.evRobot = grow(rec.evRobot, eventCap);
        rec.evKind = grow(rec.evKind, eventCap);
        rec.evArg = grow(rec.evArg, eventCap);
      }
      const e = rec.events;
      rec.evTick[e] = tick;
      rec.evRobot[e] = robot;
      rec.evKind[e] = kind;
      rec.evArg[e] = arg;
      rec.events++;
    },
  };
}

function checkTick(rec: Recording, tick: number): void {
  if (!Number.isInteger(tick) || tick < 0 || tick >= rec.frames) {
    throw new RangeError(`tick ${tick} is outside [0, ${rec.frames})`);
  }
}

/** Robot cells at `tick`, as a view into the recording (no copy). */
export function positionsAt(rec: Recording, tick: number): Int16Array {
  checkTick(rec, tick);
  return rec.positions.subarray(tick * rec.robots, (tick + 1) * rec.robots);
}

/** Robot states at `tick`, as a view into the recording (no copy). */
export function statesAt(rec: Recording, tick: number): Uint8Array {
  checkTick(rec, tick);
  return rec.states.subarray(tick * rec.robots, (tick + 1) * rec.robots);
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixByte(h: number, b: number): number {
  return Math.imul(h ^ (b & 0xff), FNV_PRIME) >>> 0;
}

function mix16(h: number, v: number): number {
  return mixByte(mixByte(h, v), v >>> 8);
}

function mix32(h: number, v: number): number {
  return mixByte(mixByte(mixByte(mixByte(h, v), v >>> 8), v >>> 16), v >>> 24);
}

/**
 * FNV-1a 32-bit over frames, positions, goals, states, and all event fields,
 * as an 8-digit lowercase hex string. Only the used part of each buffer is hashed.
 */
export function hashRecording(rec: Recording): string {
  let h = FNV_OFFSET;
  h = mix32(h, rec.frames);
  h = mix32(h, rec.robots);
  const n = rec.frames * rec.robots;
  for (let i = 0; i < n; i++) h = mix16(h, rec.positions[i]);
  for (let i = 0; i < n; i++) h = mix16(h, rec.goals[i]);
  for (let i = 0; i < n; i++) h = mixByte(h, rec.states[i]);
  h = mix32(h, rec.events);
  for (let e = 0; e < rec.events; e++) {
    h = mix32(h, rec.evTick[e]);
    h = mix16(h, rec.evRobot[e]);
    h = mixByte(h, rec.evKind[e]);
    h = mix32(h, rec.evArg[e]);
  }
  return h.toString(16).padStart(8, '0');
}
