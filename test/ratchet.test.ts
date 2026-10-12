import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRatchet, BLOCKED_PREFIX } from '../src/ratchet.ts';
import { mergeRound, priorStateFrom } from '../src/merge.ts';
import { rubric, verdict } from './helpers.ts';
import type { PriorState } from '../src/types.ts';

function priorAfter(round: number, spec: Parameters<typeof verdict>[2]): PriorState {
  return priorStateFrom(mergeRound(rubric, round, verdict('A', round, spec)));
}

test('round 1: everything counts, nothing is blocked', () => {
  const r = applyRatchet(undefined, verdict('A', 1, { correct: 'FAIL', clear: 'FAIL' }));
  assert.equal(r.verdict.verdict, 'NEEDS_WORK');
  assert.deepEqual(r.blocked, []);
  assert.deepEqual(r.fixed, []);
});

test('round 2: a fixed objection is reported as fixed, a remaining one as still failing', () => {
  const r = applyRatchet(priorAfter(1, { correct: 'FAIL', clear: 'FAIL' }), verdict('A', 2, { clear: 'FAIL' }));
  assert.deepEqual(r.fixed, ['correct']);
  assert.deepEqual(r.stillFailing, ['clear']);
  assert.equal(r.verdict.verdict, 'NEEDS_WORK');
});

test('round 2: a new objection on a previously passed criterion WITHOUT verified evidence is blocked', () => {
  const input = verdict('A', 2, { complete: { result: 'FAIL', reason: 'I would add a summary', evidence: 'n/a' } });
  const r = applyRatchet(priorAfter(1, { correct: 'FAIL' }), input);
  assert.deepEqual(r.blocked, ['complete']);
  assert.equal(r.verdict.verdict, 'PASS');
  const c = r.verdict.criteria.find((x) => x.id === 'complete');
  assert.equal(c?.result, 'PASS');
  assert.equal(c?.fix, undefined);
  assert.ok(r.verdict.optional.some((o) => o.startsWith(BLOCKED_PREFIX) && o.includes('I would add a summary') && o.includes('fix complete A')));
});

test('round 2: a new objection on a previously passed criterion WITH verified evidence counts', () => {
  const r = applyRatchet(priorAfter(1, { correct: 'FAIL' }), verdict('A', 2, { complete: { result: 'FAIL', evidence: '"Install"', verified: true } }));
  assert.deepEqual(r.newWithEvidence, ['complete']);
  assert.deepEqual(r.blocked, []);
  assert.equal(r.verdict.verdict, 'NEEDS_WORK');
});

test('round 2: a FAIL on a criterion disputed last round needs verified evidence too', () => {
  const merged = mergeRound(rubric, 1, verdict('A', 1, {}), verdict('B', 1, { clear: 'FAIL' }));
  const prior = priorStateFrom(merged);
  assert.deepEqual(prior.disputed, ['clear']);
  assert.deepEqual(applyRatchet(prior, verdict('A', 2, { clear: 'FAIL' })).blocked, ['clear']);
  assert.deepEqual(applyRatchet(prior, verdict('A', 2, { clear: { result: 'FAIL', verified: true } })).newWithEvidence, ['clear']);
});

test('the input verdict is not mutated', () => {
  const input = verdict('A', 2, { clear: 'FAIL' });
  const before = JSON.stringify(input);
  applyRatchet(priorAfter(1, {}), input);
  assert.equal(JSON.stringify(input), before);
});

test('simulated drift: without the rule objections keep coming, with it the loop converges', () => {
  // A judge that fixes last round's objection but invents one new unevidenced objection every round.
  const ids = ['correct', 'complete', 'clear'];
  let prior = priorAfter(1, { correct: 'FAIL' });
  let countedWithRule = 0;
  let countedWithoutRule = 0;
  for (let round = 2; round <= 4; round++) {
    const next = ids[(round - 1) % ids.length];
    const raw = verdict('A', round, { [next]: 'FAIL' });
    countedWithoutRule += raw.criteria.filter((c) => c.result === 'FAIL').length;
    const r = applyRatchet(prior, raw);
    countedWithRule += r.verdict.criteria.filter((c) => c.result === 'FAIL').length;
    prior = priorStateFrom(mergeRound(rubric, round, r.verdict));
  }
  assert.equal(countedWithoutRule, 3);
  assert.equal(countedWithRule, 0);
});
