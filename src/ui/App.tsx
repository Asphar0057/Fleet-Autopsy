// Playback app (design.md D10, Requirement 9). The Sim lives in a memo keyed by
// (layout, robots, seed). A rAF loop owns the playhead and redraws the canvas every
// frame it changes; React state for the header, panel, and scrubber is published at
// about 10 Hz so 16× playback does not re-render React on every tick.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawFrame, fitCanvas, readColors } from '../render/canvasRenderer';
import { parseLayout } from '../sim/layout';
import type { Layout, LayoutManifest, LayoutMeta } from '../sim/layout';
import { createWaitCounter, stalledAt, throughputSeries } from '../sim/metrics';
import { createSim } from '../sim/sim';
import type { Sim } from '../sim/sim';
import { verifyRun } from '../sim/verify';
import { badgeText } from './badge';
import type { Badge } from './badge';
import { Controls } from './Controls';
import { Panel } from './Panel';
import { clampPlayhead, pad4, stepBack, stepForward, tickInterval } from './playback';
import type { Speed } from './playback';
import { Scrubber } from './Scrubber';

const DEFAULT_LAYOUT = 'fulfillment-block';
const DEFAULT_SEED = 42;
const PUBLISH_MS = 100; // React state updates at about 10 Hz
const VERIFY_MS = 250; // re-verify the growing recording at most 4 times a second
const MAX_STEPS_PER_FRAME = 32; // cap catch-up after a background tab

const EMPTY_SERIES = new Int16Array(0);

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function loadManifest(): Promise<LayoutMeta[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}layouts/layouts.json`);
  if (!res.ok) throw new Error(`layouts.json: http ${res.status}`);
  return ((await res.json()) as LayoutManifest).layouts;
}

async function loadLayout(meta: LayoutMeta): Promise<Layout> {
  const res = await fetch(`${import.meta.env.BASE_URL}layouts/${meta.file}`);
  if (!res.ok) throw new Error(`${meta.file}: http ${res.status}`);
  return parseLayout(meta, await res.text());
}

/** Keyboard shortcuts are ignored while focus is in a field that uses the keys itself. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

/** Mutable playback state shared by the rAF loop and the event handlers. */
interface Runtime {
  playhead: number;
  dirty: boolean;
  playing: boolean;
  speed: Speed;
  trails: boolean;
  congestion: boolean;
}

export function App() {
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [layoutId, setLayoutId] = useState(DEFAULT_LAYOUT);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [robots, setRobots] = useState(0);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const [trails, setTrails] = useState(false);
  const [congestion, setCongestion] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Published at about 10 Hz by the loop, immediately by user actions.
  const [playhead, setPlayhead] = useState(0);
  const [frames, setFrames] = useState(1);
  const [badge, setBadge] = useState<Badge | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutCache = useRef(new Map<string, Layout>());
  const rt = useRef<Runtime>({ playhead: 0, dirty: true, playing: true, speed: 1, trails: false, congestion: false });

  // Manifest, once.
  useEffect(() => {
    let cancelled = false;
    loadManifest().then(
      (l) => {
        if (!cancelled) setLayouts(l);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(errorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Selected layout; robots reset to the layout's recommended count in the same render.
  useEffect(() => {
    const meta = layouts.find((m) => m.id === layoutId);
    if (!meta) return;
    let cancelled = false;
    const cached = layoutCache.current.get(meta.id);
    const p = cached ? Promise.resolve(cached) : loadLayout(meta);
    p.then(
      (l) => {
        if (cancelled) return;
        layoutCache.current.set(meta.id, l);
        setLoadError(null);
        setLayout(l);
        setRobots(meta.recommendedRobots);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(errorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [layouts, layoutId]);

  // A new Sim whenever layout, robots, or seed change (D10). createSim is deterministic.
  const created = useMemo((): { sim: Sim | null; error: string | null } => {
    if (!layout || robots < 1) return { sim: null, error: null };
    try {
      return { sim: createSim(layout, { seed, robots, queueCap: layout.queueCap, faults: [] }), error: null };
    } catch (e) {
      return { sim: null, error: errorText(e) };
    }
  }, [layout, robots, seed]);
  const sim = created.sim;

  // Keep the loop's view of toggles in sync and redraw on change.
  useEffect(() => {
    const r = rt.current;
    r.playing = playing;
    r.speed = speed;
    r.trails = trails;
    r.congestion = congestion;
    r.dirty = true;
  }, [playing, speed, trails, congestion]);

  const publish = useCallback(() => {
    if (!sim) return;
    setPlayhead(rt.current.playhead);
    setFrames(sim.recording.frames);
  }, [sim]);

  // Render loop for the current Sim.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext('2d');
    if (!sim || !canvas || !box || !ctx) return;
    const { layout: lay } = sim;
    const r = rt.current;
    r.playhead = 0;
    r.dirty = true;
    const stalled = new Uint8Array(sim.config.robots);
    const waits = createWaitCounter(lay);
    const colors = readColors();
    setBadge(null);
    publish();

    const draw = () => {
      const rec = sim.recording;
      const ph = r.playhead;
      stalledAt(rec, ph, stalled);
      drawFrame(ctx, lay, rec, ph, {
        trails: r.trails,
        congestion: r.congestion,
        waitCounts: r.congestion ? waits.at(rec, ph) : null,
        stalled,
        colors,
      });
    };

    const observer = new ResizeObserver(() => {
      fitCanvas(canvas, lay);
      r.dirty = true;
    });
    observer.observe(box);
    fitCanvas(canvas, lay);

    // Canvas text does not trigger web font loading; request Geist Mono and
    // redraw once it (and any other pending font) is ready.
    let cancelled = false;
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts) {
      fonts
        .load(`11px 'Geist Mono'`)
        .then(() => fonts.ready)
        .then(
          () => {
            if (!cancelled) r.dirty = true;
          },
          () => undefined,
        );
    }

    let last = performance.now();
    let acc = 0;
    let lastPublish = -Infinity;
    let lastVerify = -Infinity;
    let verifiedFrames = -1;
    let raf = 0;
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      if (r.playing) {
        acc += dt;
        const interval = tickInterval(r.speed);
        let steps = 0;
        while (acc >= interval && steps < MAX_STEPS_PER_FRAME) {
          r.playhead = stepForward(sim, r.playhead);
          acc -= interval;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) acc = 0;
        if (steps > 0) r.dirty = true;
      } else {
        acc = 0;
      }
      if (r.dirty) {
        r.dirty = false;
        draw();
      }
      if (now - lastPublish >= PUBLISH_MS) {
        lastPublish = now;
        publish();
      }
      const rec = sim.recording;
      if (rec.frames !== verifiedFrames && now - lastVerify >= VERIFY_MS) {
        lastVerify = now;
        verifiedFrames = rec.frames;
        setBadge(badgeText(verifyRun(rec, lay).length, sim.tick));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [sim, publish]);

  const seek = useCallback(
    (t: number) => {
      if (!sim) return;
      rt.current.playhead = clampPlayhead(sim, t);
      rt.current.dirty = true;
      publish();
    },
    [sim, publish],
  );

  const onStepForward = useCallback(() => {
    if (!sim) return;
    setPlaying(false);
    rt.current.playhead = stepForward(sim, rt.current.playhead);
    rt.current.dirty = true;
    publish();
  }, [sim, publish]);

  const onStepBack = useCallback(() => {
    if (!sim) return;
    setPlaying(false);
    rt.current.playhead = stepBack(rt.current.playhead);
    rt.current.dirty = true;
    publish();
  }, [sim, publish]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  // Keyboard: space toggles play, ←/→ step (Requirement 9.5).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
      if (e.key === ' ') {
        // A focused button already activates on space; let it.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onStepBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onStepForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, onStepBack, onStepForward]);

  const onLayout = useCallback(
    (id: string) => {
      if (id !== layoutId) setLayoutId(id);
    },
    [layoutId],
  );

  const rec = sim ? sim.recording : null;
  // State can lag a just-created Sim by one render; clamp into its recording.
  const shownFrames = rec ? Math.min(frames, rec.frames) : 1;
  const shownPlayhead = Math.min(playhead, shownFrames - 1);
  const series = useMemo(
    () => (sim ? throughputSeries(sim.recording, shownFrames - 1) : EMPTY_SERIES),
    [sim, shownFrames],
  );
  const meta = layouts.find((m) => m.id === (layout?.id ?? layoutId));
  const error = loadError ?? created.error;

  return (
    <div className="app">
      <header className="header">
        <h1 className="wordmark">
          Fleet <em>Autopsy</em>
        </h1>
        <p className="meta mono" aria-live="off">
          SEED {pad4(seed)} · TICK {pad4(shownPlayhead)}
        </p>
      </header>

      <Controls
        layouts={layouts}
        layoutId={layoutId}
        onLayout={onLayout}
        robots={Math.max(1, robots)}
        maxRobots={meta?.maxRobots ?? 1}
        recommendedRobots={meta?.recommendedRobots ?? 1}
        onRobots={setRobots}
        seed={seed}
        onSeed={setSeed}
        playing={playing}
        onTogglePlay={togglePlay}
        speed={speed}
        onSpeed={setSpeed}
        onStepBack={onStepBack}
        onStepForward={onStepForward}
        trails={trails}
        onTrails={setTrails}
        congestion={congestion}
        onCongestion={setCongestion}
        disabled={!sim}
      />

      <main className="main">
        <div className="stage">
          <div
            className="canvas-box"
            ref={boxRef}
            style={layout ? { aspectRatio: `${layout.width} / ${layout.height}` } : undefined}
          >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={layout ? `${layout.name} floor, ${robots} robots, tick ${shownPlayhead}` : 'warehouse floor'}
            />
          </div>
          <Scrubber rec={rec} frames={shownFrames} playhead={shownPlayhead} series={series} onSeek={seek} />
        </div>
        <Panel
          layout={layout}
          rec={rec}
          playhead={shownPlayhead}
          frames={shownFrames}
          series={series}
          badge={badge}
          error={error}
        />
      </main>
    </div>
  );
}
