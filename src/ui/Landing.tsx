// Landing view (visual-redesign Requirement 1.2 to 1.6, visual-polish Requirement 5):
// what the tool does, before any control, centred over a blurred, vignetted Backdrop.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Backdrop } from './Backdrop';
import { LANDING, LANDING_CENTER_CLASS } from './copy';

export interface LandingProps {
  onEnter(): void;
  onHowItWorks(opener: HTMLElement): void;
}

/** The text with the first occurrence of `word` wrapped in an accent span. */
function accentWord(text: string, word: string): ReactNode {
  const i = text.indexOf(word);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <span className="accent-text">{word}</span>
      {text.slice(i + word.length)}
    </>
  );
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
        <h1 className="landing-wordmark">
          Fleet Autopsy<span className="accent-dot">.</span>
        </h1>
        <p className="lede">{accentWord(LANDING.lede, 'wrong')}</p>
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
