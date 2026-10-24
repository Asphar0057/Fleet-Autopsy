// How it works drawer (visual-redesign Requirement 5): a labelled modal dialog
// with the five pipeline steps and one inline SVG diagram. Focus moves to the
// close button on open and stays inside the drawer; Root restores focus to the
// opener on close.
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { HOW_IT_WORKS } from './copy';
import { drawerKeyDown } from './focusTrap';

export interface HowItWorksProps {
  open: boolean;
  onClose(): void;
}

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

// Pipeline diagram geometry, in viewBox units (scaled to the drawer width).
const VIEW_W = 320;
const NODE_W = 248;
const NODE_H = 32;
const GAP = 20;
const NODE_X = (VIEW_W - NODE_W) / 2;
const PIPELINE: readonly { label: string; cause: boolean }[] = [
  { label: 'simulate', cause: false },
  { label: 'inject a failure', cause: false },
  { label: 'observe telemetry', cause: false },
  { label: 'detect the jam', cause: false },
  { label: 'replay timelines · verify the fix', cause: true },
];
const VIEW_H = PIPELINE.length * NODE_H + (PIPELINE.length - 1) * GAP + 1;

function Pipeline() {
  const cx = VIEW_W / 2;
  return (
    <svg
      className="pipeline"
      role="img"
      aria-label="Pipeline: simulate, then inject a failure, then observe telemetry, then detect the jam, then replay alternate timelines and verify the fix"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      preserveAspectRatio="xMidYMin meet"
    >
      {PIPELINE.map((n, i) => {
        const y = 0.5 + i * (NODE_H + GAP);
        const arrowTop = y + NODE_H;
        const arrowBottom = arrowTop + GAP;
        return (
          <g key={n.label}>
            <rect
              className={n.cause ? 'pipeline-node pipeline-node--cause' : 'pipeline-node'}
              x={NODE_X}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={4}
              vectorEffect="non-scaling-stroke"
            />
            <text className="pipeline-label" x={cx} y={y + NODE_H / 2} textAnchor="middle" dominantBaseline="central">
              {n.label}
            </text>
            {i < PIPELINE.length - 1 && (
              <path
                className="pipeline-edge"
                d={`M${cx} ${arrowTop + 3} V${arrowBottom - 3} M${cx - 4} ${arrowBottom - 7} L${cx} ${arrowBottom - 3} L${cx + 4} ${arrowBottom - 7}`}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function HowItWorks({ open, onClose }: HowItWorksProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const root = drawerRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const active = document.activeElement;
    const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
    drawerKeyDown(e, current, items.length, onClose, (i) => items[i]?.focus());
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hiw-title"
        className="drawer"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="drawer-head">
          <h2 id="hiw-title" className="drawer-title">
            How it works
          </h2>
          <button ref={closeRef} type="button" className="btn-icon" aria-label="close" title="Close (Esc)" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" fill="none" />
            </svg>
          </button>
        </header>
        <ol className="hiw-steps">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title} className="hiw-step">
              <span className="hiw-num mono">{i + 1}</span>
              <div>
                <h3 className="hiw-step-title">{s.title}</h3>
                <p className="hiw-step-body">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Pipeline />
      </aside>
    </>
  );
}
