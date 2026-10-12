import type { CriterionVerdict, Fix, JudgeVerdict, MergeResult, MergedCriterion, PriorState, Rubric } from './types.ts';

function uniq(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

function byId(v: JudgeVerdict | undefined): Map<string, CriterionVerdict> {
  return new Map((v?.criteria ?? []).map((c) => [c.id, c]));
}

/**
 * Combine the verdicts of judge A and (optionally) judge B for one round. Deterministic, no third model.
 *
 * - both PASS -> PASS
 * - both FAIL -> FAIL
 * - split, and the failing judge's evidence was found in the artifact -> FAIL (the author can check it)
 * - split without verified evidence -> DISPUTED (a human decides; the tool never picks a side)
 *
 * Outcome: any FAIL -> NEEDS_WORK; otherwise any DISPUTED -> DISPUTED; otherwise PASS.
 * Fixes are collected only from criteria that count as FAIL.
 */
export function mergeRound(rubric: Rubric, round: number, a: JudgeVerdict, b?: JudgeVerdict): MergeResult {
  const ma = byId(a);
  const mb = byId(b);
  const criteria: MergedCriterion[] = [];
  const fixes: Fix[] = [];

  const addFix = (judge: JudgeVerdict['judge'], c: CriterionVerdict | undefined) => {
    if (c?.fix) fixes.push({ id: c.id, judge, text: c.fix });
  };

  for (const { id } of rubric.criteria) {
    const ca = ma.get(id);
    const cb = mb.get(id);
    const entry: MergedCriterion = { id, a: ca, b: cb, status: 'PASS', note: '' };

    if (!cb) {
      if (ca?.result === 'FAIL') {
        entry.status = 'FAIL';
        entry.note = 'judge A failed it (single judge)';
        addFix('A', ca);
      } else {
        entry.note = 'judge A passed it (single judge)';
      }
    } else if (ca?.result === cb.result) {
      entry.status = ca.result;
      if (entry.status === 'FAIL') {
        entry.note = 'both judges failed it';
        addFix('A', ca);
        addFix('B', cb);
      } else {
        entry.note = 'both judges passed it';
      }
    } else {
      const failing = ca?.result === 'FAIL' ? { who: 'A' as const, c: ca } : { who: 'B' as const, c: cb };
      if (failing.c.evidenceVerified) {
        entry.status = 'FAIL';
        entry.note = `judge ${failing.who} failed it with evidence found in the artifact; the other judge passed it`;
        addFix(failing.who, failing.c);
      } else {
        entry.status = 'DISPUTED';
        entry.note = `judge ${failing.who} failed it without verified evidence; the other judge passed it`;
      }
    }
    criteria.push(entry);
  }

  const disputed = criteria.filter((c) => c.status === 'DISPUTED');
  const anyFail = criteria.some((c) => c.status === 'FAIL');
  const outcome = anyFail ? 'NEEDS_WORK' : disputed.length ? 'DISPUTED' : 'PASS';
  const optional = uniq([...a.optional, ...(b?.optional ?? [])]);
  return { round, outcome, criteria, fixes, optional, disputed };
}

/** What the next round's judge is told: objections that counted, criteria that passed, criteria left disputed. */
export function priorStateFrom(merged: MergeResult): PriorState {
  const prior: PriorState = { round: merged.round, objections: [], passed: [], disputed: [] };
  for (const c of merged.criteria) {
    if (c.status === 'FAIL') {
      for (const [judge, v] of [['A', c.a], ['B', c.b]] as const) {
        if (v?.result === 'FAIL') prior.objections.push({ id: c.id, judge, reason: v.reason, evidence: v.evidence, fix: v.fix });
      }
    } else if (c.status === 'DISPUTED') {
      prior.disputed.push(c.id);
    } else {
      prior.passed.push(c.id);
    }
  }
  return prior;
}
