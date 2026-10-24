// Landing view (visual-redesign Requirement 1.2 to 1.6, visual-polish Requirement 5):
// what the tool does, before any control, centred over a blurred, vignetted Backdrop.
// A one-time intro (CSS keyframes in landing.css) plays once per browser session;
// any key or click skips to the final state. Reduced motion never plays it.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Backdrop } from './Backdrop';
import { LANDING, LANDING_CENTER_CLASS } from './copy';

export interface LandingProps {
  onEnter(): void;
  onHowItWorks(opener: HTMLElement): void;
}

const WORDMARK = 'Fleet Autopsy';
const INTRO_FLAG = 'fleet-autopsy:intro-seen';
/** Words of the wordmark with their character index in WORDMARK (the space counts). */
const WORDS: readonly { text: string; start: number }[] = WORDMARK.split(' ').map((text, i, all) => ({
  text,
  start: all.slice(0, i).reduce((n, w) => n + w.length + 1, 0),
}));

/** True when the intro should play: motion allowed and not yet seen this session. */
function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return window.sessionStorage.getItem(INTRO_FLAG) === null;
  } catch {
    return false;
  }
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

/** Per-letter custom properties: --i is the stagger index, --o the offset from the centre (in characters, the dot included). */
function letterStyle(i: number): CSSProperties {
  return { '--i': i, '--o': i - (WORDMARK.length + 1) / 2 } as CSSProperties;
}

export function Landing({ onEnter, onHowItWorks }: LandingProps) {
  const enterRef = useRef<HTMLButtonElement>(null);
  const [intro] = useState(shouldPlayIntro);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    enterRef.current?.focus();
  }, []);

  // Mark the intro as seen; any key skips it (clicks are handled on <main>).
  useEffect(() => {
    if (!intro) return;
    try {
      window.sessionStorage.setItem(INTRO_FLAG, '1');
    } catch {
      // storage unavailable: the intro may play again, which is harmless
    }
    const skip = () => setSkipped(true);
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [intro]);

  const cls = ['landing', intro && 'landing--intro', intro && skipped && 'skipped'].filter(Boolean).join(' ');

  return (
    <main className={cls} onClick={intro && !skipped ? () => setSkipped(true) : undefined}>
      <div className="landing-backdrop">
        <Backdrop />
      </div>
      <div className="landing-vignette" aria-hidden="true" />
      {intro && <div className="intro-dot" aria-hidden="true" />}
      <div className={`landing-content ${LANDING_CENTER_CLASS}`}>
        <p className="eyebrow intro-up" style={{ '--k': 0 } as CSSProperties}>
          {LANDING.eyebrow}
        </p>
        <h1 className="landing-wordmark" aria-label={`${WORDMARK}.`}>
          {WORDS.map((w, wi) => (
            <span key={w.start}>
              {wi > 0 && ' '}
              {/* nowrap: the line may only break at the space, never inside a word */}
              <span className="wordmark-word" aria-hidden="true">
                {Array.from(w.text).map((ch, ci) => (
                  <span key={ci} className="wordmark-letter" style={letterStyle(w.start + ci)}>
                    {ch}
                  </span>
                ))}
                {wi === WORDS.length - 1 && (
                  <span className="accent-dot" style={letterStyle(WORDMARK.length)}>
                    .
                  </span>
                )}
              </span>
            </span>
          ))}
        </h1>
        <p className="lede intro-up" style={{ '--k': 1 } as CSSProperties}>
          {accentWord(LANDING.lede, 'wrong')}
        </p>
        <ol className="steps intro-up" style={{ '--k': 2 } as CSSProperties}>
          {LANDING.steps.map((s, i) => (
            <li key={s} className="step">
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="step-text">{s}</span>
            </li>
          ))}
        </ol>
        <p className="honesty intro-up" style={{ '--k': 3 } as CSSProperties}>
          {LANDING.honesty}
        </p>
        <div className="landing-actions intro-up" style={{ '--k': 4 } as CSSProperties}>
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
