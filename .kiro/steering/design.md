# Design system

An original, editorial, instrument-like look: black ground, white type, faint hairlines, one signal color used sparingly. A reference for mood only. Do not copy any company's logo, wordmark, or proprietary typeface.

## Tokens (`src/styles/tokens.css`)
The single home of design values. Components and the renderer read these; do not hard-code colors, sizes, or durations elsewhere.
```css
:root {
  /* color */
  --bg: #000000;
  --surface: #0a0a0a;              /* panels, drawer */
  --fg: #ffffff;                   /* primary text, 21:1 */
  --fg-2: #a3a3a3;                 /* secondary text, ~8.6:1 */
  --fg-3: #8a8a8a;                 /* tertiary, the minimum, ~6:1 */
  --hairline: rgba(255,255,255,.10);
  --hairline-strong: rgba(255,255,255,.24);
  --track: rgba(255,255,255,.10);
  --accent: #ff4a1c;               /* see Accent rules */
  /* canvas */
  --canvas-robot: #ffffff;
  --canvas-carry: rgba(255,255,255,.6);
  --canvas-wall: rgba(255,255,255,.30);
  --canvas-pod: rgba(255,255,255,.15);
  --canvas-station: rgba(255,255,255,.92);
  --canvas-station-text: #000000;
  --canvas-stall: rgba(255,255,255,.45);
  --canvas-label: #a3a3a3;
  /* type */
  --font-display: 'Instrument Serif', 'Times New Roman', serif;
  --font-body: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;
  --fs-hero: 88px; --fs-h1: 40px; --fs-h2: 24px; --fs-num: 32px;
  --fs-body: 15px; --fs-ui: 13px; --fs-mono: 12px;
  /* space */
  --s-1: 4px; --s-2: 8px; --s-3: 16px; --s-4: 24px; --s-5: 32px; --s-6: 48px; --s-7: 64px;
  --radius: 4px; --radius-pill: 999px;
  /* motion */
  --dur-fast: 150ms; --dur: 200ms; --dur-slow: 250ms; --ease: cubic-bezier(.2,.0,.0,1);
  /* focus */
  --focus: 2px solid #ffffff; --focus-offset: 2px;
}
```
Dark only, no light mode. No gradients, shadows, or blur. Radius 4px for buttons and inputs, pill for chips, switches, and slider thumbs.

## Typography
- Display: Instrument Serif, regular. Italic for one emphasized word ("Fleet *Autopsy*"). Sizes: hero 88, h1 40, section title 24, big numbers 32.
- Body: Geist 15/22. UI text (labels, buttons, notes, tables): Geist 13/20. Nothing smaller than 13px except mono meta at 12px.
- Geist Mono only for numbers and data (seed, tick, counts, values), with tabular figures.
- Sentence case everywhere. No `text-transform: uppercase`, no letter-spacing on labels.
- Contrast: body and UI text at least 4.5:1 on black. Use `--fg`, `--fg-2`, or `--fg-3`; never lighter greys for text.

## Spacing and layout
- 8px grid (`--s-*`). Max content width 1280. Generous whitespace.
- Header: wordmark (button back to the landing page) and scenario name in serif on the left; mono lowercase meta (`seed 0042 · tick 0214`) and "How it works" on the right; hairline below.
- Main: canvas about two thirds, panel about one third, separated by a vertical hairline. Panel sections separated by hairlines.
- Panel section header: serif title plus one grey sentence explaining what it shows.
- Under 1024px: stack the panel under the canvas and wrap control clusters. Under 640px: collapse the canvas legend into an info tip. No horizontal scroll from 390px to 1920px.

## Components
- Buttons: hairline-strong border, transparent, Geist 13px, 32px tall. Hover brightens the border to white. Pressed (`aria-pressed="true"`) and active fill white with black text.
- Primary button: white fill, black text. One per view.
- Quiet button: no border, grey text, white on hover.
- Control bar: three clusters (scenario, fleet, playback) separated by thin rules. Segmented controls for layout and speed, a pill switch for "Reveal ground truth", chips for overlays, 16px inline SVG icon buttons with accessible names and tooltips.
- Select: hairline border, custom caret. Range: 1px faint track, 12px round white thumb. Both keyboard operable.
- Badge: hairline border, Geist 13px. Healthy is white on black. Jam is Accent text and border. Verifier violations are an error: white border, never Accent.
- Info tip: small focusable button with `aria-label="About {term}"` and a `role="tooltip"`; shown on hover and keyboard focus. Width at most `min(240px, 100vw - 32px)`; under 1024px it opens as a fixed strip at the bottom of the viewport.
- Queue bars: 4px tall, `--track` background, white fill.
- Focus: 2px white outline, 2px offset on every focusable control. Never Accent.

## Canvas drawing rules
- Background black. No grid lines on floor cells.
- Walls: only edges between a wall cell and a non-wall cell, `--canvas-wall`, 1px, square caps. Do not fill wall cells.
- Pod slot: hollow square, `--canvas-pod`, inset 2.5px. Charger: hollow square with a small plus, same color.
- Station: filled `--canvas-station` square with its number in `--canvas-station-text` Geist Mono.
- Robot: filled `--canvas-robot` dot, radius about 0.27 cell. Carrying a pod: 1px `--canvas-carry` ring, radius about 0.42 cell.
- Stalled robot: 1px `--canvas-stall` ring, radius about 0.78 cell, plus a Geist 11px `--canvas-label` text `R17 · stalled`. At most 4 labels per frame (lowest ids first); more than 4 shows a count chip "{n} stalled".
- Trails: last 12 ticks, 1px polyline in robot color, fading opacity. Congestion: diagonal hatching in wall color, density grows with wait count.

## Accent rules
`--accent` (#ff4a1c) is used for exactly three things:
1. The culprit marker when ground truth is revealed (canvas squares and tags, scrubber fault ticks, the legend swatch).
2. The jam status badge.
3. The throughput onset marker in the telemetry sparkline.

Not for errors, focus, hover, selection, or decoration. A robot with a culprit marker shows only that marker, no grey stall ring or label.

## Motion
- UI transitions: `--dur` (200ms) with `--ease` for color, border, and opacity. `--dur-fast` for small hovers, `--dur-slow` for the drawer slide.
- The sim itself has no easing; it renders discrete ticks.
- `prefers-reduced-motion: reduce` disables all transitions, the drawer slide, and the landing backdrop animation (one static frame).

## Voice in the UI
Short, factual, sentence case: "Healthy", "Jam detected · started around tick 704", "Coming in the next step". No exclamation marks, no emoji, no marketing language.
