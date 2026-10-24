// Landing view (visual-redesign Requirement 1.2 to 1.6): what the tool does,
// before any control. The live Backdrop sits behind the text.
import { useEffect, useRef } from 'react';
import { Backdrop } from './Backdrop';
import { LANDING } from './copy';

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
      <div className="landing-content">
        <h1 className="landing-wordmark">
          Fleet <em>Autopsy</em>
        </h1>
        <p className="lede">{LANDING.lede}</p>
        <ol className="steps">
          {LANDING.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="honesty">{LANDING.honesty}</p>
        <div className="landing-actions">
          <button ref={enterRef} type="button" className="btn btn--primary" onClick={onEnter}>
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
