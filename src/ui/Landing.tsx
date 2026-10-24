// Landing view: label and actions on top; title, subtitle and honesty line
// bottom left; the three steps stacked bottom right; a frozen-robot effect above
// the title. Over the faint live Backdrop, a vignette and a film-grain overlay.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Backdrop } from './Backdrop';
import { LANDING } from './copy';
import { FrozenRobot } from './landing/FrozenRobot';

export interface LandingProps {
  onEnter(): void;
  onHowItWorks(opener: HTMLElement): void;
}

const WORDMARK = 'Fleet Autopsy';

/** The lede in two lines: the problem, then what the tool does. */
const LEDE_PROBLEM = 'When a warehouse robot fleet jams, the alarm says something went wrong, not what caused it.';
const LEDE_ANSWER = 'Fleet Autopsy replays alternate timelines to find out.';

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
      <div className="landing-backdrop">
        <Backdrop />
      </div>
      <div className="landing-vignette" aria-hidden="true" />
      <div className="landing-grain" aria-hidden="true" />

      <header className="landing-top">
        <p className="eyebrow">{LANDING.eyebrow}</p>
        <div className="landing-actions">
          <button ref={enterRef} type="button" className="btn btn--primary btn--pill" onClick={onEnter}>
            Enter the simulator
          </button>
          <button type="button" className="link" onClick={(e) => onHowItWorks(e.currentTarget)}>
            How it works
          </button>
        </div>
      </header>

      <div className="landing-bottom">
        <div className="landing-hero">
          <FrozenRobot />
          <h1 className="landing-wordmark" aria-label={`${WORDMARK}.`}>
            <span aria-hidden="true">
              {WORDMARK}
              <span className="accent-text">.</span>
            </span>
          </h1>
          <p className="lede">{accentWord(LEDE_PROBLEM, 'wrong')}</p>
          <p className="lede-answer">{LEDE_ANSWER}</p>
          <p className="honesty">{LANDING.honesty}</p>
        </div>
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
      </div>
    </main>
  );
}
