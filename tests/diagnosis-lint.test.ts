// Required test 2 (Spec 3): ESLint guards keep the Diagnoser away from the fault list
// and keep src/sim independent of src/diagnosis. Requirements 2.4, 2.5.
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const eslint = new ESLint({ cwd: root });

async function lint(code: string, file: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result.messages.filter((m) => m.severity === 2);
}

function ruleIds(messages: { ruleId: string | null }[]): (string | null)[] {
  return messages.map((m) => m.ruleId);
}

describe('diagnosis lint guards', () => {
  it('forbids reading config.faults in Diagnoser files', async () => {
    const errors = await lint(
      'export function f(config: { faults: number[] }): number {\n  return config.faults.length;\n}\n',
      'src/diagnosis/diagnose.ts',
    );
    expect(ruleIds(errors)).toContain('no-restricted-syntax');
  });

  it('forbids destructuring faults in Diagnoser files', async () => {
    const errors = await lint(
      'export function f(config: { faults: number[] }): number {\n  const { faults } = config;\n  return faults.length;\n}\n',
      'src/diagnosis/hypotheses.ts',
    );
    expect(ruleIds(errors)).toContain('no-restricted-syntax');
  });

  it('forbids value imports from sim/scenarios in Diagnoser files', async () => {
    const errors = await lint(
      "import { generateScenarios } from '../sim/scenarios';\nexport const g = generateScenarios;\n",
      'src/diagnosis/evidence.ts',
    );
    expect(ruleIds(errors)).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('allows type-only imports from sim/scenarios', async () => {
    const errors = await lint(
      "import type { Scenario } from '../sim/scenarios';\nexport type S = Scenario;\n",
      'src/diagnosis/evidence.ts',
    );
    expect(errors).toEqual([]);
  });

  it('forbids src/sim importing from src/diagnosis', async () => {
    const errors = await lint(
      "import { diagnose } from '../diagnosis/diagnose';\nexport const d = diagnose;\n",
      'src/sim/sim.ts',
    );
    expect(ruleIds(errors)).toContain('no-restricted-imports');
  });

  it('forbids telemetry importing from src/diagnosis', async () => {
    const errors = await lint(
      "import { diagnose } from '../diagnosis/diagnose';\nexport const d = diagnose;\n",
      'src/sim/jam.ts',
    );
    expect(ruleIds(errors)).toContain('no-restricted-imports');
  });

  it('applies determinism rules to src/diagnosis', async () => {
    const errors = await lint('export const r = Math.random();\n', 'src/diagnosis/score.ts');
    expect(ruleIds(errors)).toContain('no-restricted-properties');
  });
});
