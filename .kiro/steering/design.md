# Design system

An original, instrument-like look: black ground, white type, faint hairlines, one signal color used sparingly, one geometric sans. A reference for mood only. Do not copy any company's logo, wordmark, or proprietary typeface.

## Tokens (`src/styles/tokens.css`)
The single home of design values. Components read these; the renderer mirrors them (`DEFAULT_COLORS`, `CANVAS_FONT`). Do not hard-code colors, sizes, or durations elsewhere.
```css
:root {
  /* color */
  --bg: #000000;
  --surface: #0a0a0a;              /* panels, cards, drawer */
  --fg: #ffffff;                   /* primary text, 21:1 */
  --fg-2: #a3a3a3;                 /* secondary text, ~8.6:1 on #000 */
  --fg-3: #8a8a8a;                 /* tertiary text, minimum, ~6:1 on #000 */
  --hairline: rgba(255,255,255,.10);
  --hairline-strong: rgba(255,255,255,.24);
  --track: rgba(255,255,255,.10);
  --hover: rgba(255,255,255,.06);
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
  /* scrubber */
  --scrub-line: rgba(255,255,255,.6);
  --scrub-event: rgba(255,255,255,.18);
  --scrub-track: rgba(255,255,255,.3);
  /* type: one family */
  --font-sans: 'Gotham', 'Montserrat', system-ui, sans-serif;
  --fs-hero: clamp(56px, 7.5vw, 112px);
  --fs-h1: 32px; --fs-wordmark: 22px; --fs-h2: 18px;
  --fs-num: 36px; --fs-lede: 20px; --fs-body: 15px; --fs-ui: 13px; --fs-meta: 12px; --fs-eyebrow: 11px;
  --tracking-tight: -0.02em; --tracking-eyebrow: 0.08em;
  /* space and shape (8px grid) */
  --s-1: 4px; --s-2: 8px; --s-3: 16px; --s-4: 24px; --s-5: 32px; --s-6: 48px; --s-7: 64px;
  --gutter: clamp(16px, 2.5vw, 40px);
  --control-h: 36px; --radius: 6px; --radius-card: 8px; --radius-pill: 999px;
  /* motion */
  --dur-fast: 150ms; --dur: 200ms; --dur-slow: 250ms; --ease: cubic-bezier(.2,.0,.0,1);
  /* focus */
  --focus: 2px solid #ffffff; --focus-offset: 2px;
}
```
Dark only, no light mode. No shadows. The only gradient is the landing vignette; the only blur is the landing backdrop.

## Typeface
- One family everywhere: `--font-sans` (`'Gotham', 'Montserrat', system-ui, sans-serif`). Montserrat 400/500/600/700 (latin) ships from `@fontsource/montserrat`, pinned. No serif, no mono.
- Gotham drop-in: put licensed files in `public/fonts/` and uncomment the `@font-face` block at the top of `tokens.css`. Never commit Gotham files.
- Numbers (seed, tick, counts, values, metrics) use the sans with `font-variant-numeric: tabular-nums`. The `.mono` class name stays and means exactly that.

## Type scale
- Landing wordmark (hero): `--fs-hero`, weight 700. App wordmark "Fleet Autopsy": 22px, 700, one weight, no italic.
- Drawer title (h1) 32px; card and step titles 18px / 600; big numbers 36px / 600; landing lede 20px.
- Body 15px; UI text (labels, buttons, notes, tables) 13px; meta 12px.
- Headings and wordmark: weight 600–700, `letter-spacing: -0.02em`, sentence or title case.
- Eyebrow, landing only: 11px, 600, uppercase, `letter-spacing: 0.08em`. The one exception to "sentence case, no tracking on labels".
- Contrast: text at least 4.5:1 on its background (7:1 on the landing). Use `--fg`, `--fg-2`, or `--fg-3`; landing grey text uses `--fg-2`.

## Layout
- 8px grid (`--s-*`). The simulator spans the full viewport width with `--gutter` padding and no max-width; it scrolls with the page, no inner scrolling panels.
- Header: wordmark (button back to the landing) and scenario name on the left; meta (`seed 0042 · tick 0214`) and "How it works" on the right; hairline below.
- Stage: the canvas across the content width, centred, at the layout's aspect ratio, at most 62vh tall; the scrubber directly below; the legend in one centred row below the scrubber (hidden under 640px).
- Card grid under the stage, in order Verifier, Metrics, Telemetry, Assumptions and limits: 4 equal columns from 1280px, 2 from 760px, 1 below; equal heights within a row. An error card spans all columns above them.
- Card: `--surface`, 1px hairline border, 8px radius, 24px padding; title, one grey sentence saying what it shows, then content. The Telemetry card holds the jam status, "Find the cause" with its caption, the sparkline, stalled count, queue bars, and the station table in a closed "Stations" disclosure.

## Control bar
- Three clusters, left to right: Scenario (select with a visually hidden label, "Ground truth" switch with its info tip), Fleet (layout segmented control, robots slider, seed field), Playback (step back, play or pause, step forward, speed segmented control, Congestion and Trails chips). Each has a 12px / 600 `--fg-2` group label above it ("Scenario", "Fleet", "Playback"), sentence case.
- Layout buttons show `shortLayoutName` ("Fulfillment Block" → "Fulfillment").
- ≥1360px: one row, `justify-content: space-between`, 1px vertical hairlines between clusters; 1360–1439px uses tighter separator, segment and chip padding.
- 1100–1359px: Scenario and Fleet on row 1 (packed left), the whole Playback cluster on row 2 under a horizontal hairline.
- <1100px: clusters stacked as full-width rows separated by hairlines; their controls wrap as rows of controls.
- Never truncate or ellipsize any label, caption, note, or control text; no horizontal overflow from 390px up.

## Controls
- Buttons, selects, inputs, segmented controls, chips: 36px tall, 6px radius (chips and switch pill), 1px `--hairline` border, `--hairline-strong` border and `--hover` background on hover, pressed or selected white fill with black text.
- Primary button: white fill, black text, one per view. Landing primary: 48px tall, 8px radius. Quiet button: no border, grey text, white on hover.
- Select: custom chevron caret. Range: 2px track, 14px round white thumb. Number input matches the other controls.
- Icon buttons: 36px squares, 16px inline SVG icons, accessible names and tooltips.
- Tap targets at least 36×36px (info tips get a `::before` hit area).
- Tooltips: small black cards, 1px hairline border, 8px radius, `role="tooltip"`, shown on hover and keyboard focus, width at most `min(240px, 100vw - 32px)`; under 1024px they open as a fixed strip at the bottom of the viewport.
- Badge: hairline border, 13px. Healthy is white on black. Jam is Accent text and border. Verifier violations are an error: white border, never Accent.
- Queue bars: 4px tall, `--track` background, white fill.
- Focus: 2px white outline, 2px offset on every focusable control, including `summary` and links. Never Accent.

## Landing
- Content centred horizontally and vertically: eyebrow "Robotics and hardware", wordmark, one-sentence lede (max 640px), three steps (number in a small circle, text below; stacked under 760px), grey honesty line, then "Enter the simulator" with the "How it works" link beside it.
- Backdrop: the healthy live sim with `filter: blur(3px)` and opacity .30, under a fixed radial vignette from `rgba(0,0,0,.55)` at the centre to `#000` at the edges (the one allowed gradient).
- Content fades in over 400ms on mount; no fade under reduced motion.

## Canvas drawing rules
- Background black. No grid lines on floor cells.
- Walls: only edges between a wall cell and a non-wall cell, `--canvas-wall`, 1px, square caps. Do not fill wall cells.
- Pod slot: hollow square, `--canvas-pod`, inset 2.5px. Charger: hollow square with a small plus, same color.
- Station: filled `--canvas-station` square with its number in `--canvas-station-text`, `CANVAS_FONT` weight 500.
- Robot: filled `--canvas-robot` dot, radius about 0.27 cell. Carrying a pod: 1px `--canvas-carry` ring, radius about 0.42 cell.
- Stalled robot: 1px `--canvas-stall` ring, radius about 0.78 cell, plus a `500 11px` `CANVAS_FONT` `--canvas-label` text `R17 · stalled`. At most 4 labels per frame (lowest ids first); more than 4 shows a count chip "{n} stalled". Chips and reveal tags use the same font, 11–12px.
- Trails: last 12 ticks, 1px polyline in robot color, fading opacity. Congestion: diagonal hatching in wall color, density grows with wait count.

## Accent rules
`--accent` (#ff4a1c) is used only for:
1. Culprit markers when ground truth is revealed: canvas squares and tags, scrubber fault ticks, the reveal legend swatch, and the "find the cause" node in the drawer diagram.
2. The jam status badge.
3. The throughput onset marker in the telemetry sparkline.

Never for errors, focus, hover, selection, or decoration. A robot with a culprit marker shows only that marker, no grey stall ring or label.

## Motion
- Hover transitions 150ms (`--dur-fast`); other UI transitions `--dur` with `--ease`; `--dur-slow` for the drawer slide.
- The sim has no easing; it renders discrete ticks.
- `prefers-reduced-motion: reduce` disables all transitions and animations, the drawer slide, the landing fade, and the backdrop animation (one static frame).

## Voice in the UI
Short, factual, sentence case: "Healthy", "Jam detected · started around tick 704", "Coming in the next step". No exclamation marks, no emoji, no marketing language.
