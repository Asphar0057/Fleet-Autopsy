import { describe, expect, it } from 'vitest';
import { diagnoseInWorker } from '../src/diagnosis/client';
import { diagnose } from '../src/diagnosis/diagnose';
import type { DiagnoseRequest, Diagnosis, ObservedConfig, WorkerLike, WorkerMessage } from '../src/diagnosis/types';
import { detectJam } from '../src/sim/jam';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import type { FaultEvent } from '../src/sim/types';
import { loadPreset } from './helpers';

/** A fake worker: records calls; the test drives its messages. */
class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerMessage }) => void) | null = null;
  onerror: ((ev: { message?: string }) => void) | null = null;
  posted: DiagnoseRequest[] = [];
  terminated = 0;
  postMessage(message: DiagnoseRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated++;
  }
  emit(data: WorkerMessage): void {
    this.onmessage?.({ data });
  }
}

// The client passes the request and result through untouched, so opaque values suffice.
const request = { gridText: 'opaque' } as unknown as DiagnoseRequest;
const result = { replaysRun: 2 } as unknown as Diagnosis;
const fault: FaultEvent = { kind: 'robot-freeze', robot: 3, tick: 550, duration: null };

describe('diagnoseInWorker', () => {
  it('forwards both progress messages, then resolves with the result and terminates', async () => {
    const w = new FakeWorker();
    const seen: [number, number, FaultEvent | null][] = [];
    const p = diagnoseInWorker(request, {
      createWorker: () => w,
      onProgress: (done, total, current) => seen.push([done, total, current]),
    });
    expect(w.posted).toEqual([request]);
    w.emit({ type: 'progress', done: 1, total: 2, current: null });
    w.emit({ type: 'progress', done: 2, total: 2, current: fault });
    w.emit({ type: 'done', result });
    await expect(p).resolves.toBe(result);
    expect(seen).toEqual([
      [1, 2, null],
      [2, 2, fault],
    ]);
    expect(w.terminated).toBe(1);
  });

  it('abort mid-run terminates once and rejects with AbortError', async () => {
    const w = new FakeWorker();
    const ac = new AbortController();
    const p = diagnoseInWorker(request, { createWorker: () => w, signal: ac.signal });
    w.emit({ type: 'progress', done: 1, total: 5, current: null });
    ac.abort();
    ac.abort();
    // Messages after settling are ignored.
    w.emit({ type: 'done', result });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.terminated).toBe(1);
  });

  it('a pre-aborted signal rejects with AbortError without creating a worker', async () => {
    const ac = new AbortController();
    ac.abort();
    let created = 0;
    const p = diagnoseInWorker(request, {
      signal: ac.signal,
      createWorker: () => {
        created++;
        return new FakeWorker();
      },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(created).toBe(0);
  });

  it('an error message terminates and rejects with that message', async () => {
    const w = new FakeWorker();
    const p = diagnoseInWorker(request, { createWorker: () => w });
    w.emit({ type: 'error', message: 'bad layout' });
    await expect(p).rejects.toThrow('bad layout');
    expect(w.terminated).toBe(1);
  });

  it('onerror terminates and rejects', async () => {
    const w = new FakeWorker();
    const p = diagnoseInWorker(request, { createWorker: () => w });
    w.onerror?.({ message: 'script failed' });
    await expect(p).rejects.toThrow('script failed');
    expect(w.terminated).toBe(1);
  });
});

describe('diagnose abort', () => {
  it('pd-holder-freeze: aborting inside the first onProgress stops after one replay', async () => {
    const s = SCENARIOS.find((x) => x.id === 'pd-holder-freeze');
    if (!s) throw new Error('no scenario');
    const layout = loadPreset(s.layoutId);
    const config = scenarioConfig(s, layout);
    const rec = runHeadless(layout, config, 2000);
    const jam = detectJam(rec, layout, 2000);
    if (!jam) throw new Error('no jam');
    const observed: ObservedConfig = { seed: config.seed, robots: config.robots, queueCap: config.queueCap };

    const ac = new AbortController();
    const dones: number[] = [];
    const p = diagnose(layout, observed, rec, jam, {
      signal: ac.signal,
      onProgress: (done) => {
        dones.push(done);
        ac.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(dones).toEqual([1]);
  }, 180_000);
});
