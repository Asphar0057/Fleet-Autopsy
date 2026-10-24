// Info tip (Requirement 2.2, 7.3): a small focusable button that shows a short
// definition on hover and on keyboard focus. The text stays in the DOM so the
// button's aria-describedby always resolves; CSS shows it on :hover and :focus-within.
import { useId } from 'react';

export interface InfoTipProps {
  /** The term being explained; the button's name is "About {label}". */
  label: string;
  /** One short sentence. */
  text: string;
}

export function InfoTip({ label, text }: InfoTipProps) {
  const id = useId();
  return (
    <span className="infotip">
      <button type="button" className="infotip-btn" aria-label={`About ${label}`} aria-describedby={id}>
        i
      </button>
      <span role="tooltip" id={id} className="infotip-text">
        {text}
      </span>
    </span>
  );
}
