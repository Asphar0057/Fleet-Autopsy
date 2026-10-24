// Shared simulation types. Plain `as const` objects (not const enums) keep
// isolated-module builds simple.

/**
 * Injected fault (Spec 2). `tick` is the first frame index the fault affects;
 * the window is `tick <= t < tick + duration`, unbounded when `duration` is null.
 */
export type FaultEvent =
  | { kind: 'robot-freeze'; tick: number; robot: number; duration: number | null }
  | { kind: 'station-slowdown'; tick: number; station: number; factor: number; duration: number | null }
  | { kind: 'blocked-cell'; tick: number; cell: number; duration: number | null }
  | { kind: 'slow-robot'; tick: number; robot: number; period: number; duration: number | null };

export type FaultKind = FaultEvent['kind'];

export interface SimConfig {
  seed: number;
  robots: number;
  queueCap: number;
  faults: FaultEvent[];
}

export const RState = { Idle: 0, ToPod: 1, ToStation: 2, Serving: 3, Returning: 4 } as const;
export type RState = (typeof RState)[keyof typeof RState];

export const EKind = { Pick: 0, Deliver: 1, ServiceStart: 2, ServiceEnd: 3, Stall: 4 } as const;
export type EKind = (typeof EKind)[keyof typeof EKind];

export const CellKind = { Wall: 0, Floor: 1, Pod: 2, Station: 3, Charger: 4 } as const;
export type CellKind = (typeof CellKind)[keyof typeof CellKind];

export interface Violation {
  kind: 'same-cell' | 'swap' | 'jump' | 'illegal-cell' | 'blocked-cell';
  tick: number;
  robots: number[];
}
