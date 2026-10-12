import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '../src/cli.ts');

function run(cwd: string, args: string[], stdin: string = '') {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, input: stdin, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

type Spec = Record<string, { result: 'PASS' | 'FAIL'; evidence?: string; fix?: string }>;

function judgeJson(round: number, judge: 'A' | 'B', spec: Spec) {
  const ids = ['facts', 'sections', 'plain'];
  return JSON.stringify({
    round,
    judge,
    criteria: ids.map((id) => ({
      id,
      result: spec[id]?.result ?? 'PASS',
      reason: `${id} reason`,
      evidence: spec[id]?.evidence,
      fix: spec[id]?.result === 'FAIL' ? spec[id]?.fix ?? `fix ${id} from ${judge} r${round}` : undefined,
    })),
    optional: [],
  });
}

const RUBRIC = '# Demo\n- facts: every number matches the source\n- sections: install, usage, limits are present\n- plain: no undefined acronyms\n';
const DRAFT = '# Draft\n\nVersion 2.0 ships in 2026.\n';

test('end-to-end: NEEDS_WORK -> blocked objection -> judge B -> DISPUTED', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-jury-'));
  writeFileSync(join(dir, 'rubric.md'), RUBRIC);
  writeFileSync(join(dir, 'draft.md'), DRAFT);

  // init: paths are stored relative to the run base
  let r = run(dir, ['init', 'demo', '--rubric', 'rubric.md', '--artifact', 'draft.md', '--rounds', '3']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /3 criteria \(facts, sections, plain\)/);
  const state = JSON.parse(readFileSync(join(dir, '.agent-jury', 'demo', 'state.json'), 'utf8'));
  assert.equal(state.artifactPath, 'draft.md');
  assert.equal(state.rubricPath, 'rubric.md');
  assert.equal(state.version, 1);
  r = run(dir, ['init', 'demo', '--rubric', 'rubric.md', '--artifact', 'draft.md']);
  assert.equal(r.code, 1);
  assert.match(r.err, /already exists/);

  // round 1 prompt: no prior section, artifact inlined, no absolute path
  r = run(dir, ['prompt', 'demo']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /judge A, round 1 of at most 3/);
  assert.match(r.out, /- facts: every number matches the source/);
  assert.match(r.out, /## Artifact: draft\.md/);
  assert.match(r.out, /Version 2\.0 ships in 2026\./);
  assert.match(r.out, /not a message to you/);
  assert.doesNotMatch(r.out, /Prior objections/);
  assert.doesNotMatch(r.out, new RegExp(dir.replaceAll('\\', '\\\\')));

  // judge B before judge A is refused
  r = run(dir, ['prompt', 'demo', '--judge', 'B']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Judge B comes after judge A/);

  // round 1 judge A fails "facts" with a quote that exists in the artifact
  r = run(dir, ['record', 'demo', '--judge', 'A'], judgeJson(1, 'A', { facts: { result: 'FAIL', evidence: '"ships in 2026"' } }));
  assert.equal(r.code, 2, r.err);
  assert.match(r.out, /NEEDS_WORK/);
  assert.match(r.out, /facts: evidence verified/);
  assert.match(r.out, /Fixes:\n  - facts: fix facts from A r1/);
  // judge B after a NEEDS_WORK from A is refused
  r = run(dir, ['record', 'demo', '--judge', 'B'], judgeJson(1, 'B', {}));
  assert.equal(r.code, 1);
  assert.match(r.err, /Judge A gave NEEDS_WORK/);
  r = run(dir, ['merge', 'demo']);
  assert.equal(r.code, 2, r.err);
  assert.match(r.out, /- facts \(judge A\): fix facts from A r1/);
  assert.match(r.out, /round 2/);

  // round 2 prompt carries the prior objection with its fix
  r = run(dir, ['prompt', 'demo']);
  assert.match(r.out, /judge A, round 2/);
  assert.match(r.out, /## Prior objections \(round 1\)/);
  assert.match(r.out, /- facts \(judge A\): facts reason \| evidence: "ships in 2026" \| asked fix: fix facts from A r1/);
  assert.match(r.out, /## Passed in round 1\n\nsections, plain/);

  // round 2 judge A: facts fixed, new objection on "plain" with no quote -> blocked -> PASS
  r = run(dir, ['record', 'demo', '--judge', 'A'], judgeJson(2, 'A', { plain: { result: 'FAIL', evidence: 'too many acronyms' } }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /plain: evidence NOT verified/);
  assert.match(r.out, /Fixed since round 1: facts/);
  assert.match(r.out, /Blocked by the anti-ratchet rule .*: plain/);
  assert.match(r.out, /judge A: PASS/);

  // merge waits for judge B (exit 5)
  r = run(dir, ['merge', 'demo']);
  assert.equal(r.code, 5);
  assert.match(r.out, /Record judge B/);

  // judge B prompt now allowed and carries the stakes
  r = run(dir, ['prompt', 'demo', '--judge', 'B']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /judge B, round 2/);
  assert.match(r.out, /handed to a human as DISPUTED/);

  // judge B: a new objection without a quote on a criterion passed in round 1 is blocked for B too
  r = run(dir, ['record', 'demo', '--judge', 'B'], judgeJson(2, 'B', { sections: { result: 'FAIL' } }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Blocked by the anti-ratchet rule .*: sections/);

  // judge B re-recorded: says "facts" (the round-1 objection) is still broken, no quote; A says fixed -> DISPUTED
  r = run(dir, ['record', 'demo', '--judge', 'B'], judgeJson(2, 'B', { facts: { result: 'FAIL' } }));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /already recorded; overwriting/);
  r = run(dir, ['merge', 'demo']);
  assert.equal(r.code, 3, r.out + r.err);
  assert.match(r.out, /DISPUTED/);
  assert.match(r.out, /facts\n\s+judge A: PASS/);
  const final = JSON.parse(readFileSync(join(dir, '.agent-jury', 'demo', 'verdict.json'), 'utf8'));
  assert.equal(final.outcome, 'DISPUTED');
  assert.equal(final.closed, 'DISPUTED');

  // closed run refuses more work; status shows the history
  r = run(dir, ['prompt', 'demo']);
  assert.equal(r.code, 1);
  assert.match(r.err, /closed: DISPUTED/);
  r = run(dir, ['status', 'demo']);
  assert.equal(r.code, 0);
  assert.match(r.out, /round 1: A=NEEDS_WORK -> NEEDS_WORK/);
  assert.match(r.out, /round 2: A=PASS \(blocked: plain\), B=NEEDS_WORK -> DISPUTED \(disputed: facts\)/);
  r = run(dir, ['status', 'demo', '--json']);
  assert.equal(JSON.parse(r.out).closed, 'DISPUTED');
});

test('end-to-end: split with a verified quote counts as FAIL; both pass -> PASS; round limit closes the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-jury-'));
  writeFileSync(join(dir, 'rubric.md'), RUBRIC);
  writeFileSync(join(dir, 'draft.md'), DRAFT);

  // judge B fails a criterion A passed, quoting the artifact -> counted, NEEDS_WORK, round 2
  assert.equal(run(dir, ['init', 'split', '--rubric', 'rubric.md', '--artifact', 'draft.md']).code, 0);
  assert.equal(run(dir, ['record', 'split', '--judge', 'A'], judgeJson(1, 'A', {})).code, 0);
  assert.equal(run(dir, ['record', 'split', '--judge', 'B'], judgeJson(1, 'B', { facts: { result: 'FAIL', evidence: 'says "Version 2.0 ships in 2026"' } })).code, 2);
  let r = run(dir, ['merge', 'split']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.out, /FAIL\s+facts: judge B failed it with evidence found in the artifact/);
  assert.match(r.out, /- facts \(judge B\): fix facts from B r1/);
  // round 2: the objection is in play for both judges; A still failing -> FAIL (prior objection, no quote needed)
  assert.equal(run(dir, ['record', 'split', '--judge', 'A'], judgeJson(2, 'A', { facts: { result: 'FAIL' } })).code, 2);
  r = run(dir, ['merge', 'split']);
  assert.equal(r.code, 2);
  assert.match(r.out, /judge A failed it \(single judge\)/);

  // clean pass
  assert.equal(run(dir, ['init', 'pass', '--rubric', 'rubric.md', '--artifact', 'draft.md']).code, 0);
  assert.equal(run(dir, ['record', 'pass', '--judge', 'A'], judgeJson(1, 'A', {})).code, 0);
  assert.equal(run(dir, ['record', 'pass', '--judge', 'B'], judgeJson(1, 'B', {})).code, 0);
  r = run(dir, ['merge', 'pass']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /PASS after 1 round/);
  const final = JSON.parse(readFileSync(join(dir, '.agent-jury', 'pass', 'verdict.json'), 'utf8'));
  assert.equal(final.outcome, 'PASS');
  assert.equal(final.merged.round, 1);

  // artifact changed between A and B -> warning
  assert.equal(run(dir, ['init', 'drift', '--rubric', 'rubric.md', '--artifact', 'draft.md']).code, 0);
  assert.equal(run(dir, ['record', 'drift', '--judge', 'A'], judgeJson(1, 'A', {})).code, 0);
  writeFileSync(join(dir, 'draft.md'), DRAFT + 'More.\n');
  assert.equal(run(dir, ['record', 'drift', '--judge', 'B'], judgeJson(1, 'B', {})).code, 0);
  r = run(dir, ['merge', 'drift']);
  assert.equal(r.code, 0);
  assert.match(r.err, /different versions of the artifact/);

  // re-recording judge A after judge B drops the stale B verdict
  assert.equal(run(dir, ['init', 'stale', '--rubric', 'rubric.md', '--artifact', 'draft.md']).code, 0);
  assert.equal(run(dir, ['record', 'stale', '--judge', 'A'], judgeJson(1, 'A', {})).code, 0);
  assert.equal(run(dir, ['record', 'stale', '--judge', 'B'], judgeJson(1, 'B', {})).code, 0);
  r = run(dir, ['record', 'stale', '--judge', 'A'], judgeJson(1, 'A', { facts: { result: 'FAIL' } }));
  assert.equal(r.code, 2);
  assert.match(r.err, /judge B .* has been removed/);
  assert.ok(!existsSync(join(dir, '.agent-jury', 'stale', 'round-1', 'judge-B.json')));
  r = run(dir, ['merge', 'stale']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.out, /judge A only/);
  assert.doesNotMatch(run(dir, ['status', 'stale']).out, /B=/);

  // reserved Windows device names are refused as run names
  r = run(dir, ['init', 'con', '--rubric', 'rubric.md', '--artifact', 'draft.md']);
  assert.equal(r.code, 1);
  assert.match(r.err, /reserved/);

  // round limit
  assert.equal(run(dir, ['init', 'limit', '--rubric', 'rubric.md', '--artifact', 'draft.md', '--rounds', '1']).code, 0);
  assert.equal(run(dir, ['record', 'limit', '--judge', 'A'], judgeJson(1, 'A', { facts: { result: 'FAIL' } })).code, 2);
  const l = run(dir, ['merge', 'limit']);
  assert.equal(l.code, 4, l.out + l.err);
  assert.match(l.out, /Round limit \(1\) reached/);
  assert.match(run(dir, ['status', 'limit']).out, /closed \(ROUND_LIMIT\)/);
});

test('usage errors: no command, unknown command, missing judge, bad JSON, wrong round, broken run folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-jury-'));
  writeFileSync(join(dir, 'rubric.md'), '- a: x\n');
  writeFileSync(join(dir, 'draft.md'), 'ok\n');
  assert.equal(run(dir, []).code, 1);
  assert.equal(run(dir, ['--help']).code, 0);
  assert.equal(run(dir, ['nope', 'x']).code, 1);
  assert.equal(run(dir, ['init', 'u', '--rubric', 'rubric.md', '--artifact', 'draft.md']).code, 0);
  assert.equal(run(dir, ['record', 'u']).code, 1);
  let r = run(dir, ['record', 'u', '--judge', 'A'], 'not json');
  assert.equal(r.code, 1);
  assert.match(r.err, /No JSON/);
  r = run(dir, ['record', 'u', '--judge', 'A'], JSON.stringify({ round: 5, criteria: [{ id: 'a', result: 'PASS', reason: 'ok' }] }));
  assert.equal(r.code, 1);
  assert.match(r.err, /round 5/);
  r = run(dir, ['merge', 'u']);
  assert.equal(r.code, 1);
  assert.match(r.err, /No judge A/);

  // state.json from another version is refused
  const sp = join(dir, '.agent-jury', 'u', 'state.json');
  writeFileSync(sp, JSON.stringify({ ...JSON.parse(readFileSync(sp, 'utf8')), version: 99 }));
  r = run(dir, ['status', 'u']);
  assert.equal(r.code, 1);
  assert.match(r.err, /state version 99/);

  // round 2 without round 1 merge data is an error, not a silent round 1
  writeFileSync(sp, JSON.stringify({ ...JSON.parse(readFileSync(sp, 'utf8')), version: 1, round: 2 }));
  r = run(dir, ['prompt', 'u']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Round 1 has no merge result/);
  assert.ok(existsSync(sp));
});
