import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAutopsy } from '../src/diagnosis/benchmark';
import { SCENARIOS } from '../src/sim/scenarios';
import { loadPreset } from './helpers';

const autopsyDir = fileURLToPath(new URL('../public/autopsies/', import.meta.url));

/** Committed autopsy text, with CRLF normalised in case git autocrlf rewrote it. */
function committed(id: string): string {
  return readFileSync(autopsyDir + `${id}.json`, 'utf8').replace(/\r\n/g, '\n');
}

describe('precomputed autopsies (Requirement 9.2)', () => {
  for (const id of ['pd-holder-freeze', 'pd-decoy-first']) {
    it(
      `${id}: buildAutopsy is byte-identical across calls and equals the committed file`,
      async () => {
        const s = SCENARIOS.find((x) => x.id === id);
        if (!s) throw new Error(`no scenario ${id}`);
        const layout = loadPreset(s.layoutId);
        const a = await buildAutopsy(layout, s);
        const b = await buildAutopsy(layout, s);
        expect(a).toBe(b);
        expect(a.endsWith('}\n')).toBe(true);
        expect(a).not.toContain('elapsedMs');
        expect(a).toBe(committed(id));
      },
      180_000,
    );
  }
});
