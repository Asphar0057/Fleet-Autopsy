// Landing view (visual-redesign Requirement 1.2 to 1.6, visual-polish Requirement 5):
// what the tool does, before any control, centred over a blurred, vignetted Backdrop.
import { useEffect, useRef } from 'react';
import { Backdrop } from './Backdrop';
import { LANDING, LANDING_CENTER_CLASS } from './copy';

export interface LandingProps {
  onEnter(): void;
  onHowItWorks(opener: HTMLElement): void;
}

export function Landing({ onEnter, onHowItWorks }: LandingProps) {
  const enterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    enterRef.current?.focus();
  }, []);

  return (
    <main className="landing">
      <Backdrop />
      <div className="landing-vignette" aria-hidden="true" />
      <div className={`landing-content ${LANDING_CENTER_CLASS}`}>
        <p className="eyebrow">{LANDING.eyebrow}</p>
        <h1 className="landing-wordmark">Fleet Autopsy</h1>
        <p className="lede">{LANDING.lede}</p>
        <ol className="steps">
          {LANDING.steps.map((s, i) => (
            <li key={s} className="step">
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="step-text">{s}</span>
            </li>
          ))}
        </ol>
        <p className="honesty">{LANDING.honesty}</p>
        <div className="landing-actions">
          <button ref={enterRef} type="button" className="btn btn--primary btn--lg" onClick={onEnter}>
            Enter the simulator
          </button>
          <button type="button" className="link" onClick={(e) => onHowItWorks(e.currentTarget)}>
            How it works
          </button>
        </div>
      </div>
    </main>
  );
}
