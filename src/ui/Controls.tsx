// Playback and run controls (Requirement 2.2, 2.3, 9.2, 9.7), grouped into three
// clusters: scenario, fleet, playback. All controls are real <button>s or labeled
// inputs; icon-only buttons carry aria-label and a title tooltip; toggles use aria-pressed.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { LayoutMeta } from '../sim/layout';
import type { Scenario } from '../sim/types';
import { InfoTip } from './InfoTip';
import { SPEEDS } from './playback';
import type { Speed } from './playback';

const MAX_SEED = 2 ** 31 - 1;

export interface ControlsProps {
  layouts: LayoutMeta[];
  layoutId: string;
  onLayout(id: string): void;
  robots: number;
  maxRobots: number;
  recommendedRobots: number;
  onRobots(n: number): void;
  seed: number;
  onSeed(n: number): void;
  playing: boolean;
  onTogglePlay(): void;
  speed: Speed;
  onSpeed(s: Speed): void;
  onStepBack(): void;
  onStepForward(): void;
  trails: boolean;
  onTrails(on: boolean): void;
  congestion: boolean;
  onCongestion(on: boolean): void;
  /** Curated scenarios; the select shows "Healthy fleet" (value '') plus each by name. */
  scenarios: readonly Scenario[];
  /** Selected scenario id, or null for healthy. */
  scenarioId: string | null;
  onScenario(id: string | null): void;
  reveal: boolean;
  onReveal(on: boolean): void;
  disabled: boolean;
}

/* 16px inline icons, stroked or filled in currentColor; decorative (the button has the name). */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const StepBackIcon = () => (
  <Icon>
    <rect x="3" y="3" width="1.5" height="10" fill="currentColor" />
    <path d="M13 3 L5.5 8 L13 13 Z" fill="currentColor" />
  </Icon>
);

const StepForwardIcon = () => (
  <Icon>
    <path d="M3 3 L10.5 8 L3 13 Z" fill="currentColor" />
    <rect x="11.5" y="3" width="1.5" height="10" fill="currentColor" />
  </Icon>
);

const PlayIcon = () => (
  <Icon>
    <path d="M4.5 2.5 L13 8 L4.5 13.5 Z" fill="currentColor" />
  </Icon>
);

const PauseIcon = () => (
  <Icon>
    <rect x="4" y="3" width="2.5" height="10" fill="currentColor" />
    <rect x="9.5" y="3" width="2.5" height="10" fill="currentColor" />
  </Icon>
);

export function Controls(p: ControlsProps) {
  const [seedDraft, setSeedDraft] = useState(String(p.seed));

  // A scenario sets the seed from outside; show it unless the draft already means it.
  useEffect(() => {
    setSeedDraft((d) => (/^\d+$/.test(d) && Number(d) === p.seed ? d : String(p.seed)));
  }, [p.seed]);

  const onSeedInput = (v: string) => {
    setSeedDraft(v);
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      if (n <= MAX_SEED) p.onSeed(n);
    }
  };

  return (
    <div className="controls">
      <div className="cluster cluster--scenario" role="group" aria-label="scenario">
        <label className="field-label" htmlFor="scenario">
          Choose a failure scenario
        </label>
        <span className="select">
          <select
            id="scenario"
            value={p.scenarioId ?? ''}
            onChange={(e) => p.onScenario(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">Healthy fleet</option>
            {p.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <button type="button" className="switch" aria-pressed={p.reveal} onClick={() => p.onReveal(!p.reveal)}>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            Reveal ground truth
          </button>
          <InfoTip label="ground truth" text="Shows which injected fault is the real cause." />
        </span>
      </div>

      <div className="cluster cluster--fleet" role="group" aria-label="fleet">
        <span className="field">
          <span className="field-label" aria-hidden="true">
            Layout
          </span>
          <span className="segmented" role="group" aria-label="layout">
            {p.layouts.map((m) => (
              <button
                key={m.id}
                type="button"
                className="btn"
                aria-pressed={m.id === p.layoutId}
                onClick={() => p.onLayout(m.id)}
              >
                {m.name}
              </button>
            ))}
          </span>
        </span>

        <span className="field">
          <label className="field-label" htmlFor="robots">
            Robots
          </label>
          <input
            id="robots"
            type="range"
            min={1}
            max={p.maxRobots}
            step={1}
            value={p.robots}
            disabled={p.disabled}
            onChange={(e) => p.onRobots(Number(e.target.value))}
          />
          <output className="mono value" htmlFor="robots">
            {p.robots}
          </output>
          {p.robots > p.recommendedRobots && (
            <span className="note">Above recommended {p.recommendedRobots} · jams expected</span>
          )}
        </span>

        <span className="field">
          <label className="field-label" htmlFor="seed">
            Seed
          </label>
          <input
            id="seed"
            className="mono"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_SEED}
            step={1}
            value={seedDraft}
            onChange={(e) => onSeedInput(e.target.value)}
            onBlur={() => setSeedDraft(String(p.seed))}
          />
        </span>
      </div>

      <div className="cluster cluster--playback" role="group" aria-label="playback">
        <span className="field">
          <button
            type="button"
            className="btn-icon"
            aria-label="step back"
            title="Step back (←)"
            onClick={p.onStepBack}
            disabled={p.disabled}
          >
            <StepBackIcon />
          </button>
          <button
            type="button"
            className="btn-icon btn-icon--primary"
            aria-label={p.playing ? 'pause' : 'play'}
            title="Play or pause (space)"
            onClick={p.onTogglePlay}
            disabled={p.disabled}
          >
            {p.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="step forward"
            title="Step forward (→)"
            onClick={p.onStepForward}
            disabled={p.disabled}
          >
            <StepForwardIcon />
          </button>
        </span>

        <span className="field">
          <span className="field-label" aria-hidden="true">
            Speed
          </span>
          <span className="segmented" role="group" aria-label="speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className="btn mono"
                aria-label={`speed ${s}x`}
                aria-pressed={s === p.speed}
                onClick={() => p.onSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </span>
        </span>

        <span className="field" role="group" aria-label="overlays">
          <button
            type="button"
            className="chip"
            aria-pressed={p.congestion}
            onClick={() => p.onCongestion(!p.congestion)}
          >
            Congestion
          </button>
          <button type="button" className="chip" aria-pressed={p.trails} onClick={() => p.onTrails(!p.trails)}>
            Trails
          </button>
        </span>
      </div>
    </div>
  );
}
