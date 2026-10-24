// Display copy for the redesigned UI (visual-redesign design.md). Pure, no DOM.
// Sentence case throughout. badge.ts and jamBadge.ts keep their uppercase output
// for their existing tests; the UI reads these strings instead.
import type { Jam } from '../sim/jam';
import { THROUGHPUT_WINDOW } from '../sim/metrics';
import { STANDSTILL_SHORT } from '../sim/telemetry';
import type { Badge } from './badge';

/** 'Verified · 0 violations · 2000 ticks', or '3 violations · 214 ticks' as an alert. */
export function verifierCopy(violations: number, ticks: number): Badge {
  if (violations === 0) return { text: `Verified · 0 violations · ${ticks} ticks`, alert: false };
  const noun = violations === 1 ? 'violation' : 'violations';
  return { text: `${violations} ${noun} · ${ticks} ticks`, alert: true };
}

/** 'Healthy', or 'Jam detected · started around tick 704 · severity 100%' as an alert. */
export function jamCopy(jam: Jam | null): Badge {
  if (jam === null) return { text: 'Healthy', alert: false };
  return {
    text: `Jam detected · started around tick ${jam.onsetTick} · severity ${Math.round(jam.severity * 100)}%`,
    alert: true,
  };
}

/** Live-region text; changes only with the jam state and onset, not every severity update. */
export function jamAnnouncement(jam: Jam | null): string {
  return jam === null ? 'healthy' : `jam detected, started around tick ${jam.onsetTick}`;
}

export const LANDING: { eyebrow: string; lede: string; steps: readonly string[]; honesty: string } = {
  eyebrow: 'Robotics and hardware',
  lede:
    'When a warehouse robot fleet jams, the alarm tells you something went wrong, not what caused it. ' +
    'Fleet Autopsy replays alternate timelines to find out.',
  steps: [
    'Inject a failure',
    'Detect the jam from telemetry',
    'Replay timelines to find the cause and verify the fix',
  ],
  honesty: 'Simulation only. The faults are injected, so the ground truth is known.',
};

export const HOW_IT_WORKS: readonly { title: string; body: string }[] = [
  {
    title: 'Simulate',
    body: 'A seeded, deterministic fleet moves pods to pick stations on a grid. The same seed always gives the same run.',
  },
  {
    title: 'Inject a failure',
    body: 'A scenario adds faults such as a frozen robot, a slow station, or a blocked cell. Some are decoys.',
  },
  {
    title: 'Observe telemetry',
    body: 'Only what an operator could see is measured: throughput, station queues, and stalled robots.',
  },
  {
    title: 'Detect the jam',
    body: 'A fixed rule compares throughput with a healthy baseline and reports when the jam started and how severe it is.',
  },
  {
    title: 'Replay alternate timelines and verify the fix',
    body: 'Each suspect is removed in a replay. The one whose removal restores throughput is the cause, and the replay verifies the fix.',
  },
];

export const SECTION_NOTES: {
  verifier: string;
  metrics: string;
  telemetry: string;
  stations: string;
  assumptions: string;
} = {
  verifier: 'Checks every tick that no two robots collide and none cross a wall',
  metrics: 'How much work the fleet completes',
  telemetry: 'What an operator can observe: throughput, queues, stalled robots',
  stations: 'Pods waiting at each station right now',
  assumptions: 'What this simulation takes as given',
};

export const TERMS: { throughput: string; stalled: string; onset: string; severity: string } = {
  throughput: `Deliveries completed in the last ${THROUGHPUT_WINDOW} ticks.`,
  stalled: `A robot is stalled when it has not moved for ${STANDSTILL_SHORT} ticks or more while it has work.`,
  onset: 'The last tick where throughput still looked healthy before the drop.',
  severity: 'How far throughput has fallen below the healthy baseline, from 0% to 100%.',
};

export const LEGEND_ITEMS: readonly { mark: 'robot' | 'carry' | 'station' | 'stall'; text: string }[] = [
  { mark: 'robot', text: 'white dot = robot' },
  { mark: 'carry', text: 'ring = carrying a pod' },
  { mark: 'station', text: 'square = station' },
  { mark: 'stall', text: 'grey ring = stalled' },
];

/** Display name for a layout button: drops a trailing generic word ("Fulfillment Block" -> "Fulfillment"). */
export function shortLayoutName(name: string): string {
  const short = name.replace(/\s+Block$/, '');
  return short === '' ? name : short;
}

/** Run-details card titles, in display order (Requirement 4.2). */
export const CARD_TITLES = ['Verifier', 'Metrics', 'Telemetry', 'Assumptions and limits'] as const;

/** Class on the landing content container that centres it (Requirement 5.1). */
export const LANDING_CENTER_CLASS = 'landing-content--center';
