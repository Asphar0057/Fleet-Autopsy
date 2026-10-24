# Design system

An original, minimal, editorial look: white paper, black hairlines, one signal color. A reference for mood only. Do not copy any company's logo, wordmark, or proprietary typeface.

## Tokens (`src/styles/tokens.css`)
```css
:root {
  --bg: #ffffff;
  --ink: #000000;
  --ink-2: #6b6b6b;      /* secondary text, units */
  --line: #000000;       /* structure: 1px */
  --line-soft: rgba(0,0,0,.14);
  --accent: #ff4a1c;     /* ONLY for alerts, violations, root-cause highlight */
  --radius: 2px;
  --font-display: 'Instrument Serif', 'Times New Roman', serif;
  --font-body: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;
}
```
No dark mode. No gradients, no shadows, no blur, no rounded corners above 2px.

## Typography
- Display and headings: Instrument Serif, regular. Use italic for one emphasized word (for example "Fleet *Autopsy*"). Sizes: 76 / 40 / 28.
- Body: Geist 15/22.
- Labels, numbers, data, buttons: Geist Mono. Labels are 11px, uppercase, letter-spacing .08em. Numbers use tabular figures.
- Section headers in the side panel are mono labels with an index: `01  METRICS`, `02  STATIONS`.

## Layout
- 8px grid. Max content width 1280. Generous whitespace.
- Header: wordmark left, mono meta right (`SEED 0042 · TICK 0214`), 1px bottom rule.
- Main: canvas takes about two thirds, panel about one third, separated by a 1px vertical black line. Panel sections are separated by 1px horizontal lines.
- Bottom: scrubber with a throughput line (1px black) and event ticks.
- Works down to 1024px wide. On narrower screens, stack the panel under the canvas.

## Components
- Buttons: 1px black border, transparent, mono 11px uppercase, radius 2px. Hover inverts (black fill, white text). Focus: 2px outline, 2px offset.
- Inputs and sliders: 1px line, no fill, mono values. Slider thumb is a black square.
- Badge (verifier): 1px border, mono. Passing is black on white. A violation is accent text with an accent border.
- Motion: 120ms linear for hover, none for the sim. Respect `prefers-reduced-motion`.

## Canvas drawing rules (blueprint style)
- Background white. No grid lines on floor cells.
- Walls: draw only edges between a wall cell and a non-wall cell, 1.4px black, square caps. Do not fill wall cells.
- Pod slot: hollow square, 1px black, inset 2.5px.
- Station: solid black square with its number in white mono.
- Charger: hollow square with a small plus.
- Robot: solid black dot, radius about 0.27 cell. Carrying a pod: add a 1px ring, radius about 0.42 cell.
- Trails: last 12 ticks, 1px black polyline, fading opacity.
- Congestion layer: diagonal black hatching (about 45°, 0.6px lines) whose density grows with wait count. No color.
- Accent is used for one thing at a time: a stalled robot (ring r about 0.78 cell plus a mono label such as `R17 · STALL`), a violation, or the root-cause highlight.
- A reference frame of all three layouts in this style is in `layouts-preview.png`.

## Voice in the UI
Short, factual, lowercase microcopy: "no violations", "replaying 214 timelines". No exclamation marks, no emoji.
