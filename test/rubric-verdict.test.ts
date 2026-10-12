import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRubric, slug } from '../src/rubric.ts';
import { extractJson, validateVerdict } from '../src/verdict.ts';
import { checkEvidence } from '../src/evidence.ts';
import { rubric } from './helpers.ts';

test('parseRubric: title, explicit ids, slug ids, prose ignored', () => {
  const r = parseRubric(`# Landing copy\n\nSome intro.\n\n- hook: The first sentence names the reader's problem.\n* The call to action says what happens next.\n3. \`no-jargon\`: No undefined acronyms.\n`);
  assert.equal(r.title, 'Landing copy');
  assert.deepEqual(
    r.criteria.map((c) => c.id),
    ['hook', 'the-call-to-action-says-what-happens-next', 'no-jargon'],
  );
});

test('parseRubric: duplicate id, empty rubric and an item with no usable id are errors', () => {
  assert.throws(() => parseRubric('- a: one\n- a: two'), /two criteria/);
  assert.throws(() => parseRubric('# Only a title'), /no criteria/);
  assert.throws(() => parseRubric('- 你好'), /Cannot make an id/);
});

test('slug strips diacritics and punctuation', () => {
  assert.equal(slug('Pełne zdania, bez żargonu!'), 'pelne-zdania-bez-zargonu');
});

test('extractJson: fenced block, bare JSON, prose around braces, second fenced block', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a":1}\n```\nthanks'), { a: 1 });
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Verdict below. {"a":1} End.'), { a: 1 });
  assert.deepEqual(extractJson('```md\nnot json\n```\n\n```json\n{"b":2}\n```'), { b: 2 });
  assert.throws(() => extractJson('no json here'), /No JSON/);
});

const ok = {
  round: 1,
  judge: 'A',
  verdict: 'PASS',
  criteria: [
    { id: 'correct', result: 'PASS', reason: 'ok' },
    { id: 'complete', result: 'PASS', reason: 'ok' },
    { id: 'clear', result: 'PASS', reason: 'ok' },
  ],
  optional: ['could be shorter'],
};

test('validateVerdict: accepts a complete verdict and keeps optional notes', () => {
  const { verdict, warnings } = validateVerdict(ok, rubric, { round: 1, judge: 'A' });
  assert.equal(verdict.verdict, 'PASS');
  assert.deepEqual(verdict.optional, ['could be shorter']);
  assert.deepEqual(warnings, []);
});

test('validateVerdict: verdict is derived from criteria, with a warning when the judge disagrees with itself', () => {
  const input = { ...ok, criteria: [{ ...ok.criteria[0], result: 'FAIL', fix: 'change the date' }, ...ok.criteria.slice(1)] };
  const { verdict, warnings } = validateVerdict(input, rubric, { round: 1, judge: 'A' });
  assert.equal(verdict.verdict, 'NEEDS_WORK');
  assert.equal(verdict.criteria[0].fix, 'change the date');
  assert.ok(warnings.some((w) => w.includes('criteria say NEEDS_WORK')));
});

test('validateVerdict: normalizes round, judge, id and result casing', () => {
  const input = { round: '1', judge: ' a ', criteria: ok.criteria.map((c) => ({ ...c, id: c.id.toUpperCase(), result: 'pass' })) };
  const { verdict } = validateVerdict(input, rubric, { round: 1, judge: 'A' });
  assert.equal(verdict.verdict, 'PASS');
  assert.deepEqual(verdict.criteria.map((c) => c.id), ['correct', 'complete', 'clear']);
});

test('validateVerdict: rejects wrong round, wrong judge, unknown or missing criteria, bad result, empty reason', () => {
  assert.throws(() => validateVerdict({ ...ok, round: 2 }, rubric, { round: 1, judge: 'A' }), /round 2/);
  assert.throws(() => validateVerdict(ok, rubric, { round: 1, judge: 'B' }), /judge "A"/);
  assert.throws(() => validateVerdict({ ...ok, criteria: [...ok.criteria, { id: 'extra', result: 'PASS', reason: 'x' }] }, rubric, { round: 1, judge: 'A' }), /not in the rubric/);
  assert.throws(() => validateVerdict({ ...ok, criteria: ok.criteria.slice(1) }, rubric, { round: 1, judge: 'A' }), /did not assess: correct/);
  assert.throws(() => validateVerdict({ ...ok, criteria: [{ ...ok.criteria[0], result: 'MAYBE' }, ...ok.criteria.slice(1)] }, rubric, { round: 1, judge: 'A' }), /PASS or FAIL/);
  assert.throws(() => validateVerdict({ ...ok, criteria: [{ ...ok.criteria[0], reason: '' }, ...ok.criteria.slice(1)] }, rubric, { round: 1, judge: 'A' }), /reason/);
});

test('validateVerdict: a FAIL without a fix warns; a top-level "fixes" list becomes optional notes; non-string fields warn', () => {
  const input = {
    ...ok,
    criteria: [{ ...ok.criteria[0], result: 'FAIL', evidence: ['a', 'b'] }, { ...ok.criteria[1], fix: 42 }, ok.criteria[2]],
    fixes: ['unpinned'],
  };
  const { verdict, warnings } = validateVerdict(input, rubric, { round: 1, judge: 'A' });
  assert.ok(warnings.some((w) => w.includes('failed without a "fix"')));
  assert.ok(warnings.some((w) => w.includes('Top-level "fixes"')));
  assert.ok(warnings.some((w) => w.includes('criteria[complete].fix')));
  assert.equal(verdict.criteria[0].evidence, 'a | b');
  assert.ok(verdict.optional.includes('[unpinned fix] unpinned'));
});

test('checkEvidence: a specific quote found in the artifact counts; line numbers, short words, placeholders, opinions and foreign quotes do not', () => {
  const artifact = 'Line one.\nVersion 2.0 ships in 2026.\nSee the "Install" section.\n';
  assert.equal(checkEvidence('"ships in 2026"', artifact).ok, true);
  assert.equal(checkEvidence('the text says “Version 2.0   ships” twice', artifact).ok, true);
  assert.equal(checkEvidence('Version 2.0 ships in 2026.', artifact).ok, true);
  assert.equal(checkEvidence('"Version 2.0 ships" (line 2)', artifact).ok, true);
  // a line number alone, or a made-up quote with a real line number, proves nothing
  assert.equal(checkEvidence('line 2', artifact).ok, false);
  assert.equal(checkEvidence('"ships in 2099" (line 2)', artifact).ok, false);
  // single words and short fragments appear in any text
  assert.equal(checkEvidence('"2026"', artifact).ok, false);
  assert.equal(checkEvidence('"Install"', artifact).ok, false);
  assert.match(checkEvidence('"Install"', artifact).why, /at least 12/);
  assert.equal(checkEvidence('ships', artifact).ok, false);
  assert.equal(checkEvidence('n/a', artifact).ok, false);
  assert.equal(checkEvidence(undefined, artifact).ok, false);
  assert.equal(checkEvidence('it reads badly', artifact).ok, false);
  assert.equal(checkEvidence('"ships in 2025"', artifact).ok, false);
  // CRLF artifacts and quotes that span a line break still match
  assert.equal(checkEvidence('"one.\nVersion 2.0"', artifact.replaceAll('\n', '\r\n')).ok, true);
});

test('extractJson prefers the block that holds criteria; escape codes and non-string ids are handled', () => {
  const echoed = '```json\n{"round": 1, "judge": "A", "note": "schema echo"}\n```\n\n```json\n{"round": 1, "criteria": []}\n```';
  assert.deepEqual(extractJson(echoed), { round: 1, criteria: [] });
  const esc = { ...ok, criteria: [{ ...ok.criteria[0], reason: '\u001b[31mred\u001b[0m ok' }, ...ok.criteria.slice(1)] };
  assert.equal(validateVerdict(esc, rubric, { round: 1, judge: 'A' }).verdict.criteria[0].reason, 'red ok');
  assert.throws(() => validateVerdict({ ...ok, criteria: [{ ...ok.criteria[0], id: ['correct'] }, ...ok.criteria.slice(1)] }, rubric, { round: 1, judge: 'A' }), /string "id"/);
  assert.throws(() => validateVerdict({ ...ok, criteria: [{ ...ok.criteria[0], reason: { x: 1 } }, ...ok.criteria.slice(1)] }, rubric, { round: 1, judge: 'A' }), /reason/);
});
