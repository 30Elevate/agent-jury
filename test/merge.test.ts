import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRound, priorStateFrom } from '../src/merge.ts';
import { rubric, verdict } from './helpers.ts';

test('both judges pass -> PASS, no fixes', () => {
  const r = mergeRound(rubric, 1, verdict('A', 1, {}), verdict('B', 1, {}));
  assert.equal(r.outcome, 'PASS');
  assert.deepEqual(r.fixes, []);
  assert.deepEqual(r.disputed, []);
  assert.ok(r.criteria.every((c) => c.status === 'PASS'));
});

test('both judges fail the same criterion -> NEEDS_WORK with both fixes, pinned to the criterion', () => {
  const r = mergeRound(rubric, 1, verdict('A', 1, { correct: 'FAIL' }), verdict('B', 1, { correct: 'FAIL' }));
  assert.equal(r.outcome, 'NEEDS_WORK');
  assert.deepEqual(r.fixes, [
    { id: 'correct', judge: 'A', text: 'fix correct A' },
    { id: 'correct', judge: 'B', text: 'fix correct B' },
  ]);
  assert.equal(r.criteria.find((c) => c.id === 'correct')?.status, 'FAIL');
});

test('split with verified evidence -> FAIL for that criterion, NEEDS_WORK, only the failing judge contributes fixes', () => {
  const r = mergeRound(rubric, 2, verdict('A', 2, {}), verdict('B', 2, { correct: { result: 'FAIL', evidence: '"ships in 2025"', verified: true } }));
  assert.equal(r.outcome, 'NEEDS_WORK');
  assert.equal(r.criteria.find((c) => c.id === 'correct')?.status, 'FAIL');
  assert.deepEqual(r.fixes.map((f) => f.judge), ['B']);
  assert.deepEqual(r.disputed, []);
});

test('split with unverified evidence -> DISPUTED, no fixes, handed to a human', () => {
  const r = mergeRound(rubric, 2, verdict('A', 2, {}), verdict('B', 2, { clear: { result: 'FAIL', evidence: 'it reads badly' } }));
  assert.equal(r.outcome, 'DISPUTED');
  assert.equal(r.disputed.length, 1);
  assert.equal(r.disputed[0].id, 'clear');
  assert.deepEqual(r.fixes, []);
});

test('a counted FAIL outranks a DISPUTED criterion in the outcome', () => {
  const r = mergeRound(rubric, 1, verdict('A', 1, { complete: 'FAIL' }), verdict('B', 1, { complete: 'FAIL', clear: 'FAIL' }));
  assert.equal(r.outcome, 'NEEDS_WORK');
  assert.equal(r.criteria.find((c) => c.id === 'clear')?.status, 'DISPUTED');
});

test('single judge: outcome follows judge A', () => {
  assert.equal(mergeRound(rubric, 1, verdict('A', 1, {})).outcome, 'PASS');
  assert.equal(mergeRound(rubric, 1, verdict('A', 1, { clear: 'FAIL' })).outcome, 'NEEDS_WORK');
});

test('optional notes from both judges are kept and de-duplicated', () => {
  const r = mergeRound(
    rubric,
    1,
    verdict('A', 1, {}, { optional: ['shorter intro', 'shorter intro'] }),
    verdict('B', 1, {}, { optional: ['shorter intro', 'use a table'] }),
  );
  assert.deepEqual(r.optional, ['shorter intro', 'use a table']);
});

test('priorStateFrom: objections only from criteria that count as FAIL; disputed kept apart; the rest passed', () => {
  const merged = mergeRound(
    rubric,
    1,
    verdict('A', 1, { correct: 'FAIL' }),
    verdict('B', 1, { correct: 'FAIL', clear: 'FAIL' }),
  );
  const p = priorStateFrom(merged);
  assert.equal(p.round, 1);
  assert.deepEqual(p.objections.map((o) => [o.id, o.judge, o.fix]), [['correct', 'A', 'fix correct A'], ['correct', 'B', 'fix correct B']]);
  assert.deepEqual(p.disputed, ['clear']);
  assert.deepEqual(p.passed, ['complete']);
});
