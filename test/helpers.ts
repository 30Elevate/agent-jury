import type { CriterionVerdict, JudgeId, JudgeVerdict, Rubric } from '../src/types.ts';

export const rubric: Rubric = {
  title: 'Test rubric',
  criteria: [
    { id: 'correct', text: 'Every fact matches the source.' },
    { id: 'complete', text: 'Every section the task asked for is present.' },
    { id: 'clear', text: 'A new reader understands it in one pass.' },
  ],
};

type FailSpec = { result: 'FAIL'; evidence?: string; verified?: boolean; reason?: string; fix?: string };
type Spec = Record<string, 'PASS' | 'FAIL' | FailSpec>;

/**
 * Build a verdict from a compact spec: { correct: 'PASS', clear: { result: 'FAIL', verified: true } }.
 * A plain 'FAIL' has a fix but no verified evidence. `verified: true` marks the evidence as found in the artifact.
 */
export function verdict(judge: JudgeId, round: number, spec: Spec, extra: Partial<JudgeVerdict> = {}): JudgeVerdict {
  const criteria: CriterionVerdict[] = rubric.criteria.map(({ id }) => {
    const s = spec[id] ?? 'PASS';
    if (s === 'PASS') return { id, result: 'PASS', reason: `${id} pass` };
    const f: FailSpec = s === 'FAIL' ? { result: 'FAIL' } : s;
    const c: CriterionVerdict = { id, result: 'FAIL', reason: f.reason ?? `${id} fail`, fix: f.fix ?? `fix ${id} ${judge}`, evidenceVerified: Boolean(f.verified) };
    if (f.evidence) c.evidence = f.evidence;
    return c;
  });
  const anyFail = criteria.some((c) => c.result === 'FAIL');
  return { round, judge, verdict: anyFail ? 'NEEDS_WORK' : 'PASS', criteria, optional: [], ...extra };
}
