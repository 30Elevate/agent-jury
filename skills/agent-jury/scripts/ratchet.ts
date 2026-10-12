import type { JudgeVerdict, PriorState, RatchetReport } from './types.ts';

export const BLOCKED_PREFIX = '[not counted: no verified evidence]';

/**
 * The anti-ratchet rule.
 *
 * Round 1: everything counts. From round 2 on, a FAIL on a criterion that the previous
 * round failed is "still failing" and counts. A FAIL on a criterion that the previous
 * round passed, or disputed without evidence, counts ONLY when `evidenceVerified` is
 * true (set by `record` after checking the quote against the artifact). Otherwise the
 * objection and its fix move to `optional`, the criterion is recorded as PASS, and the
 * verdict is recomputed. The bar does not rise between rounds.
 *
 * Returns a new verdict; the input is not changed.
 */
export function applyRatchet(prior: PriorState | undefined, input: JudgeVerdict): RatchetReport {
  const verdict: JudgeVerdict = {
    ...input,
    criteria: input.criteria.map((c) => ({ ...c })),
    optional: [...input.optional],
  };
  const report: RatchetReport = { verdict, fixed: [], stillFailing: [], newWithEvidence: [], blocked: [] };
  if (!prior) return report;

  const priorFail = new Set(prior.objections.map((o) => o.id));

  for (const c of verdict.criteria) {
    if (c.result === 'PASS') {
      if (priorFail.has(c.id)) report.fixed.push(c.id);
      continue;
    }
    if (priorFail.has(c.id)) {
      report.stillFailing.push(c.id);
      continue;
    }
    if (c.evidenceVerified) {
      report.newWithEvidence.push(c.id);
      continue;
    }
    report.blocked.push(c.id);
    verdict.optional.push(`${BLOCKED_PREFIX} ${c.id}: ${c.reason}${c.fix ? ` | suggested fix: ${c.fix}` : ''}`);
    c.result = 'PASS';
    c.reason = `Not counted: passed in round ${prior.round} and the new objection has no verified evidence.`;
    delete c.fix;
  }

  verdict.verdict = verdict.criteria.some((c) => c.result === 'FAIL') ? 'NEEDS_WORK' : 'PASS';
  return report;
}
