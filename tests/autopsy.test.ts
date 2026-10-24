// Autopsy UI (Spec 4): step reducer, headless smoke over the curated autopsies,
// baselines on the decoy, and template-report numbers.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/sim/scenarios';
import { autopsyReducer, INITIAL_AUTOPSY } from '../src/ui/autopsy/autopsyState';
import type { AutopsyAction, AutopsyState } from '../src/ui/autopsy/autopsyState';
import { baselineRows, focusTick, stepCopy, suspects } from '../src/ui/autopsy/model';
import { templateReport } from '../src/ui/autopsy/report';
import { CURATED_AUTOPSIES } from '../src/ui/autopsy/types';
import type { AutopsyData } from '../src/ui/autopsy/types';
import { loadPreset } from './helpers';

const dir = fileURLToPath(new URL('../public/autopsies/', import.meta.url));
const load = (id: string): { text: string; data: AutopsyData } => {
  const text = readFileSync(dir + `${id}.json`, 'utf8');
  return { text, data: JSON.parse(text) as AutopsyData };
};

const actionArb: fc.Arbitrary<AutopsyAction> = fc.oneof(
  fc.constant({ type: 'next' as const }),
  fc.constant({ type: 'back' as const }),
  fc.integer({ min: -10, max: 10 }).map((step) => ({ type: 'goto' as const, step })),
);

describe('autopsyReducer', () => {
  it('keeps the step in 1..5 and never resets reached4', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
        let s: AutopsyState = INITIAL_AUTOPSY;
        let seen4 = false;
        for (const a of actions) {
          s = autopsyReducer(s, a);
          expect(s.step).toBeGreaterThanOrEqual(1);
          expect(s.step).toBeLessThanOrEqual(5);
          seen4 ||= s.step >= 4;
          expect(s.reached4).toBe(seen4);
        }
      }),
    );
  });
});

describe('curated autopsies', () => {
  for (const id of CURATED_AUTOPSIES) {
    it(`${id}: reduces through steps 1 to 5`, () => {
      const { data } = load(id);
      const scenario = SCENARIOS.find((s) => s.id === id) ?? null;
      const layout = loadPreset(data.layoutId);
      let s = INITIAL_AUTOPSY;
      for (let step = 1; step <= 5; step++) {
        expect(s.step).toBe(step);
        const c = stepCopy(data, step);
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.caption.length).toBeGreaterThan(0);
        expect(focusTick(data, step)).toBeGreaterThanOrEqual(0);
        const rows = baselineRows(data, layout, scenario, s.reached4);
        expect(rows).toHaveLength(3);
        // Marks only once step 4 is reached.
        for (const r of rows) expect(r.correct === null).toBe(!s.reached4);
        s = autopsyReducer(s, { type: 'next' });
      }
      expect(s).toEqual({ step: 5, reached4: true });
      expect(suspects(data)[0].lead).toBe(true);
      // Curated: diagnosed correctly with a passing fix.
      expect(baselineRows(data, layout, scenario, true)[0].correct).toBe(true);
      expect(data.fix.passed).toBe(true);
    });
  }

  it('pd-decoy-first: blame the first alarm is wrong', () => {
    const { data } = load('pd-decoy-first');
    const scenario = SCENARIOS.find((s) => s.id === 'pd-decoy-first') ?? null;
    const rows = baselineRows(data, loadPreset(data.layoutId), scenario, true);
    expect(rows[1].method).toBe('Blame the first alarm');
    expect(rows[1].correct).toBe(false);
  });

  for (const id of CURATED_AUTOPSIES) {
    it(`${id}: every number in the report appears in the autopsy JSON`, () => {
      const { text, data } = load(id);
      const numbers: number[] = [];
      const strings: string[] = [];
      const walk = (v: unknown): void => {
        if (typeof v === 'number') numbers.push(v);
        else if (typeof v === 'string') strings.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(JSON.parse(text));
      const report = templateReport(data);
      for (const tok of report.match(/\d+(?:\.\d+)?/g) ?? []) {
        const dec = tok.includes('.') ? tok.split('.')[1].length : 0;
        const ok = numbers.some((n) => n.toFixed(dec) === tok) || strings.some((s) => s.includes(tok));
        expect(ok, `report number ${tok}`).toBe(true);
      }
    });
  }
});
