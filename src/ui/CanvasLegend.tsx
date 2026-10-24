// Canvas legend (Requirement 4.4): an always-visible key under the canvas. Under
// 640px CSS hides the list and shows an info tip with the same text instead.
// While ground truth is revealed, the one-line fault legend is added below.
import { LEGEND_ITEMS } from './copy';
import { InfoTip } from './InfoTip';

type Mark = (typeof LEGEND_ITEMS)[number]['mark'];

const LEGEND_TEXT = LEGEND_ITEMS.map((i) => i.text).join(', ');

/** 12px inline swatch matching the canvas drawing for each mark. */
function Swatch({ mark }: { mark: Mark }) {
  return (
    <svg className="legend-swatch" width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {mark === 'robot' && <circle cx={6} cy={6} r={3} fill="var(--canvas-robot)" />}
      {mark === 'carry' && <circle cx={6} cy={6} r={5} fill="none" stroke="var(--canvas-carry)" strokeWidth={1} />}
      {mark === 'station' && <rect x={1} y={1} width={10} height={10} fill="var(--fg)" />}
      {mark === 'stall' && <circle cx={6} cy={6} r={5} fill="none" stroke="var(--canvas-stall)" strokeWidth={1} />}
    </svg>
  );
}

export interface CanvasLegendProps {
  /** faultLegend text while ground truth is revealed, else null. */
  reveal: string | null;
}

export function CanvasLegend({ reveal }: CanvasLegendProps) {
  return (
    <div className="legend-block">
      <ul className="canvas-legend" aria-label="legend">
        {LEGEND_ITEMS.map((item) => (
          <li key={item.mark} className="legend-item">
            <Swatch mark={item.mark} />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      <span className="legend-tip">
        <span className="label">Legend</span>
        <InfoTip label="legend" text={LEGEND_TEXT} />
      </span>
      {reveal !== null && (
        <p className="reveal-legend" title={reveal}>
          <svg
            className="legend-swatch"
            width={12}
            height={12}
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
          >
            <rect x={1.5} y={1.5} width={9} height={9} fill="none" stroke="var(--accent)" strokeWidth={1} />
          </svg>
          <span className="reveal-legend-text">{reveal}</span>
        </p>
      )}
    </div>
  );
}
