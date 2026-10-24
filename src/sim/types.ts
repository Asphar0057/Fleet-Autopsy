// Shared simulation types. Plain `as const` objects (not const enums) keep
// isolated-module builds simple.

/** Stub for Spec 2 failure injection. Accepted and ignored in this spec (D13). */
export type FaultEvent = { tick: number; kind: string };

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
  kind: 'same-cell' | 'swap' | 'jump' | 'illegal-cell';
  tick: number;
  robots: number[];
}
