// "Find the cause" in the Telemetry card: enabled on a jam; progress with Cancel
// while the worker replays; an error or cancel note with Retry.

export type FindStatus =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' };

export interface FindCauseProps {
  status: FindStatus;
  jam: boolean;
  curated: boolean;
  open: boolean;
  onFind(): void;
  onCancel(): void;
}

export function FindCause({ status, jam, curated, open, onFind, onCancel }: FindCauseProps) {
  const running = status.kind === 'running';
  let note: string;
  if (running) note = status.total > 0 ? `Replaying timelines · ${status.done} of ${status.total}` : 'Preparing replays';
  else if (status.kind === 'error') note = `Diagnosis failed · ${status.message}`;
  else if (status.kind === 'aborted') note = 'Diagnosis cancelled';
  else if (open) note = 'Autopsy open below the canvas';
  else if (!jam) note = 'No jam to diagnose';
  else note = curated ? 'Opens the precomputed autopsy for this scenario' : 'Replays alternate timelines in the background';
  const retry = status.kind === 'error' || status.kind === 'aborted';
  return (
    <div className="find-cause">
      {running ? (
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary"
          disabled={!jam && !retry}
          aria-describedby="find-cause-note"
          onClick={onFind}
        >
          {retry ? 'Retry' : 'Find the cause'}
        </button>
      )}
      {running && (
        <span
          className="qbar find-progress"
          role="progressbar"
          aria-label="replays done"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, status.total)}
          aria-valuenow={status.done}
        >
          <span className="qbar-fill" style={{ width: `${status.total > 0 ? (status.done / status.total) * 100 : 0}%` }} />
        </span>
      )}
      <p id="find-cause-note" className="note" role="status">
        {note}
      </p>
    </div>
  );
}
