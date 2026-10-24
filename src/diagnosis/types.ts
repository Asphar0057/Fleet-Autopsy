// Diagnosis types (Spec 3). Every output is plain JSON-safe data: numbers,
// strings, booleans, null, arrays, and plain objects. No typed arrays, Maps, or Sets.

import type { FaultEvent, FaultKind } from '../sim/types';
import type { LayoutMeta } from '../sim/layout';
import type { Recording } from '../sim/recorder';
import type { Jam } from '../sim/jam';

/** What an operator sees of a run's configuration: no fault list. */
export interface ObservedConfig {
  seed: number;
  robots: number;
  queueCap: number;
}

/** A fault kind plus its robot, station, or cell. */
export interface Target {
  kind: FaultKind;
  robot?: number;
  station?: number;
  cell?: number;
}

/** Observation window: frames 0..endTick. */
export interface Window {
  endTick: number;
}

export interface Standstill {
  robot: number;
  start: number;
  end: number;
  cell: number;
  serving: boolean;
}

/** A station service; `end` is -1 while still running at detectedTick. */
export interface Service {
  robot: number;
  start: number;
  end: number;
}

export interface Evidence {
  detectedTick: number;
  onsetTick: number;
  /** Per robot at detectedTick; -1 if moving. */
  standstillStart: number[];
  standstillCell: number[];
  /** Robots in first-stalled order (start, then id). */
  stalled: number[];
  /** Closed and open episodes, by start then robot. */
  episodes: Standstill[];
  /** Top 16 cells by waits, then cell index. */
  hotspots: { cell: number; waits: number }[];
  /** Per station, by start. */
  services: Service[][];
  /** Per station, ServiceEnd count up to detectedTick. */
  completions: number[];
  /** Throughput curve 0..detectedTick. */
  throughput: number[];
  /** Per robot, move frames in (onsetTick - 200, detectedTick]. */
  moves: number[][];
  /** Busy cells that went empty. */
  lastOccupied: { cell: number; tick: number; entries: number }[];
}

export interface RankedFault {
  fault: FaultEvent;
  score: number;
  gain: number;
  /** Deliveries per 100 ticks recovered on removal. */
  impact: number;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

export interface ScoredHypothesis {
  fault: FaultEvent;
  preScore: number;
  score: number | null;
}

export interface Diagnosis {
  rootCause: RankedFault | null;
  /** Selection order. */
  faults: RankedFault[];
  hypotheses: ScoredHypothesis[];
  evidence: Evidence;
  replaysRun: number;
  window: Window;
  elapsedMs: number;
}

export interface DiagnoseOptions {
  onProgress?: (done: number, total: number, current: FaultEvent | null) => void;
  signal?: AbortSignal;
}

export interface FixResult {
  fix: string | null;
  removed: FaultEvent[];
  /** Deliveries per 100 ticks. */
  throughputBaseline: number;
  throughputBefore: number;
  throughputAfter: number;
  recoveredFraction: number;
  passed: boolean;
  verifiedBy: 'simulation';
}

/** Message sent to the diagnosis worker. */
export interface DiagnoseRequest {
  meta: LayoutMeta;
  gridText: string;
  config: ObservedConfig;
  rec: Recording;
  jam: Jam;
}

/** Messages posted by the diagnosis worker. */
export type WorkerMessage =
  | { type: 'progress'; done: number; total: number; current: FaultEvent | null }
  | { type: 'done'; result: Diagnosis }
  | { type: 'error'; message: string };

/** The subset of `Worker` the client uses, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(message: DiagnoseRequest): void;
  terminate(): void;
  onmessage: ((ev: { data: WorkerMessage }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
}
