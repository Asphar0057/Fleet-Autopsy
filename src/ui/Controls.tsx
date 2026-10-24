// Playback and run controls (Requirement 9.2, 9.7). All controls are real
// <button>s or labeled inputs; icon-only buttons carry aria-label; toggles use aria-pressed.
import { useState } from 'react';
import type { LayoutMeta } from '../sim/layout';
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
  disabled: boolean;
}

export function Controls(p: ControlsProps) {
  const [seedDraft, setSeedDraft] = useState(String(p.seed));

  const onSeedInput = (v: string) => {
    setSeedDraft(v);
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      if (n <= MAX_SEED) p.onSeed(n);
    }
  };

  return (
    <div className="controls">
      <div className="control-group" role="group" aria-label="layout">
        <span className="label">layout</span>
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
      </div>

      <div className="control-group">
        <label className="label" htmlFor="robots">
          robots
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
          <span className="note">above recommended {p.recommendedRobots} · jams expected</span>
        )}
      </div>

      <div className="control-group">
        <label className="label" htmlFor="seed">
          seed
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
      </div>

      <div className="control-group" role="group" aria-label="playback">
        <button type="button" className="btn" aria-label="step back" onClick={p.onStepBack} disabled={p.disabled}>
          ◀
        </button>
        <button type="button" className="btn btn--play" onClick={p.onTogglePlay} disabled={p.disabled}>
          {p.playing ? 'pause' : 'play'}
        </button>
        <button
          type="button"
          className="btn"
          aria-label="step forward"
          onClick={p.onStepForward}
          disabled={p.disabled}
        >
          ▶
        </button>
      </div>

      <div className="control-group" role="group" aria-label="speed">
        <span className="label">speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            aria-label={`speed ${s}x`}
            aria-pressed={s === p.speed}
            onClick={() => p.onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="control-group" role="group" aria-label="overlays">
        <button type="button" className="btn" aria-pressed={p.congestion} onClick={() => p.onCongestion(!p.congestion)}>
          congestion
        </button>
        <button type="button" className="btn" aria-pressed={p.trails} onClick={() => p.onTrails(!p.trails)}>
          trails
        </button>
      </div>
    </div>
  );
}
