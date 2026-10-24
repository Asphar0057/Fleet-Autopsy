// Autopsy step logic (Spec 4): a small pure reducer. The step stays in 1..5;
// `reached4` is set once the step is 4 or more and never resets.

export const STEP_COUNT = 5;

export interface AutopsyState {
  step: number;
  /** True once the user has reached step 4; gates the ground-truth marks. */
  reached4: boolean;
}

export type AutopsyAction = { type: 'next' } | { type: 'back' } | { type: 'goto'; step: number };

export const INITIAL_AUTOPSY: AutopsyState = { step: 1, reached4: false };

export function autopsyReducer(s: AutopsyState, a: AutopsyAction): AutopsyState {
  let raw: number;
  if (a.type === 'next') raw = s.step + 1;
  else if (a.type === 'back') raw = s.step - 1;
  else raw = Number.isFinite(a.step) ? Math.round(a.step) : s.step;
  const step = Math.min(STEP_COUNT, Math.max(1, raw));
  const reached4 = s.reached4 || step >= 4;
  return step === s.step && reached4 === s.reached4 ? s : { step, reached4 };
}
