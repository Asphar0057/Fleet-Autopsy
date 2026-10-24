// Landing view: actions top right; the jam scene upper left; bottom left the
// label, title, subtitle lines and honesty note; steps stacked bottom right.
// A CSS-timed intro (landing.css) plays on mount; reduced motion shows the
// final state. Over the faint live Backdrop, a vignette and a film-grain overlay.
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Backdrop } from './Backdrop';
import { LANDING } from './copy';
import { JamScene } from './landing/JamScene';

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

/** Stagger index for intro animations. */
const k = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

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

      <div className="landing-actions">
        <button ref={enterRef} type="button" className="btn btn--primary btn--pill" onClick={onEnter}>
          Enter the simulator
        </button>
        <button type="button" className="link" onClick={(e) => onHowItWorks(e.currentTarget)}>
          How it works
        </button>
      </div>

      <JamScene />

      <div className="landing-bottom">
        <div className="landing-hero">
          <p className="eyebrow">{LANDING.eyebrow}</p>
          <h1 className="landing-wordmark" aria-label={`${WORDMARK}.`}>
            <span aria-hidden="true">
              {WORDMARK.split(' ').map((word, wi, words) => {
                const offset = words.slice(0, wi).reduce((n, w) => n + w.length + 1, 0);
                return (
                  <span key={wi}>
                    {wi > 0 && ' '}
                    <span className="wordmark-word">
                      {Array.from(word).map((ch, ci) => (
                        <span key={ci} className="wordmark-letter" style={k(offset + ci)}>
                          {ch}
                        </span>
                      ))}
                      {wi === words.length - 1 && <span className="accent-dot">.</span>}
                    </span>
                  </span>
                );
              })}
            </span>
          </h1>
          <p className="lede intro-up" style={k(0)}>
            {accentWord(LEDE_PROBLEM, 'wrong')}
          </p>
          <p className="lede-answer intro-up" style={k(1)}>
            {LEDE_ANSWER}
          </p>
          <p className="honesty intro-up" style={k(2)}>
            {LANDING.honesty}
          </p>
        </div>
        <ol className="steps">
          {LANDING.steps.map((s, i) => (
            <li key={s} className="step" style={k(i)}>
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="step-text">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="landing-grain" aria-hidden="true" />
    </main>
  );
}
