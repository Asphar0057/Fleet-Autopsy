// Main-thread client for the diagnosis worker (Spec 3, Requirement 8.4; design
// "Worker (task 9)", D12). Holds no diagnosis logic: it posts the request, forwards
// progress, and settles once on done, error, or abort.

import { abortError } from './diagnose';
import type { DiagnoseOptions, DiagnoseRequest, Diagnosis, WorkerLike } from './types';

export interface DiagnoseInWorkerOptions extends DiagnoseOptions {
  /** Worker factory; tests inject a fake. */
  createWorker?: () => WorkerLike;
}

// The global Worker constructor, typed narrowly so the node tsconfig (tests, no DOM lib)
// also type-checks this file. Type-only: erased at build, the runtime global is used.
declare const Worker: new (url: URL, options: { type: 'module' }) => WorkerLike;

const defaultCreateWorker = (): WorkerLike =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as WorkerLike;

/**
 * Runs `diagnose` in a Web Worker. Resolves with the Diagnosis; rejects with an
 * AbortError on abort (terminating the worker once) or with an Error on failure.
 */
export function diagnoseInWorker(req: DiagnoseRequest, opts: DiagnoseInWorkerOptions = {}): Promise<Diagnosis> {
  const { signal, onProgress, createWorker = defaultCreateWorker } = opts;
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise<Diagnosis>((resolve, reject) => {
    const worker = createWorker();
    let settled = false;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      finish();
    };

    function onAbort(): void {
      settle(() => reject(abortError()));
    }

    worker.onmessage = (ev) => {
      if (settled) return;
      const m = ev.data;
      switch (m.type) {
        case 'progress':
          onProgress?.(m.done, m.total, m.current);
          break;
        case 'done':
          settle(() => resolve(m.result));
          break;
        case 'error':
          settle(() => reject(new Error(m.message)));
          break;
      }
    };
    worker.onerror = (ev) => {
      settle(() => reject(new Error(ev.message ?? 'diagnosis worker failed')));
    };
    signal?.addEventListener('abort', onAbort);

    try {
      worker.postMessage(req);
    } catch (e) {
      settle(() => reject(e instanceof Error ? e : new Error(String(e))));
    }
  });
}
