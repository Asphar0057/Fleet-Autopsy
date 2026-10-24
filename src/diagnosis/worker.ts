// Diagnosis worker entry (Spec 3, Requirement 8.4; design "Worker (task 9)", D13).
// One request per worker: parse the layout, run `diagnose`, post progress per replay,
// then the result or an error message.

import { parseLayout } from '../sim/layout';
import { diagnose } from './diagnose';
import type { DiagnoseRequest, WorkerMessage } from './types';

/** The part of the dedicated worker scope used here; no WebWorker lib in the DOM tsconfig. */
interface DiagnosisWorkerScope {
  postMessage(message: WorkerMessage): void;
  onmessage: ((ev: { data: DiagnoseRequest }) => void) | null;
}

const scope = self as unknown as DiagnosisWorkerScope;

scope.onmessage = (ev) => {
  void run(ev.data);
};

async function run(req: DiagnoseRequest): Promise<void> {
  try {
    const layout = parseLayout(req.meta, req.gridText);
    const result = await diagnose(layout, req.config, req.rec, req.jam, {
      onProgress: (done, total, current) => scope.postMessage({ type: 'progress', done, total, current }),
    });
    scope.postMessage({ type: 'done', result });
  } catch (e) {
    scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
