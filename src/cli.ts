#!/usr/bin/env node
// agent-jury: a review loop that ends. The CLI keeps the state of a run and enforces the rules.
// It never calls a model. The host agent runs the judges and pipes their JSON back in.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRubric } from './rubric.ts';
import { extractJson, validateVerdict } from './verdict.ts';
import { checkEvidence } from './evidence.ts';
import { applyRatchet } from './ratchet.ts';
import { mergeRound, priorStateFrom } from './merge.ts';
import { buildJudgePrompt } from './prompt.ts';
import {
  loadJudge,
  loadMerge,
  loadState,
  readText,
  removeJudge,
  runDir,
  runExists,
  saveFinal,
  saveJudge,
  saveMerge,
  saveState,
  sha256,
} from './store.ts';
import { STATE_VERSION } from './types.ts';
import type { JudgeId, JudgeVerdict, PriorState, RunState } from './types.ts';

export const EXIT = {
  OK: 0,
  USAGE: 1,
  NEEDS_WORK: 2,
  DISPUTED: 3,
  ROUND_LIMIT: 4,
  WAITING: 5,
} as const;

const MIN_NODE = [22, 18] as const;

const USAGE = `agent-jury - a review loop that ends

Usage:
  agent-jury init   <run> --rubric <file> --artifact <file> [--rounds 3]
  agent-jury prompt <run> [--judge A|B] [--path-only]
  agent-jury record <run> --judge A|B [--file <reply>]    (the saved judge reply: a fenced JSON block or bare JSON; stdin without --file)
  agent-jury merge  <run>
  agent-jury status <run> [--json]

Every command accepts --dir <folder> (default: current folder). State lives in <dir>/.agent-jury/<run>/.
Paths given to init are stored relative to <dir>, so a run folder can be shared without exposing your file system.

Exit codes: 0 PASS or done | 1 usage or invalid input | 2 NEEDS_WORK (fix, then next round) | 3 DISPUTED (a human decides) | 4 round limit reached without PASS (run closed, a human decides) | 5 waiting for judge B`;

class CliError extends Error {
  code: number;
  constructor(message: string, code: number = EXIT.USAGE) {
    super(message);
    this.code = code;
  }
}

function assertNode(): void {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return;
  throw new CliError(`agent-jury needs Node ${MIN_NODE.join('.')} or newer (it runs TypeScript directly). You have ${process.versions.node}.`);
}

function judgeId(v: string | undefined): JudgeId {
  const j = (v ?? '').trim().toUpperCase();
  if (j !== 'A' && j !== 'B') throw new CliError('--judge must be A or B.');
  return j;
}

/** Store a path relative to the base folder; a file outside the base folder stays absolute. */
function storedPath(base: string, p: string): string {
  const abs = resolve(p);
  const rel = relative(resolve(base), abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replaceAll('\\', '/') : abs;
}

function absPath(base: string, stored: string): string {
  return isAbsolute(stored) ? stored : resolve(base, stored);
}

function artifactText(base: string, state: RunState): string {
  const p = absPath(base, state.artifactPath);
  if (!existsSync(p)) throw new CliError(`Artifact file not found: ${p} (recorded in the run as "${state.artifactPath}").`);
  return readText(p);
}

function priorFor(base: string, state: RunState): PriorState | undefined {
  if (state.round <= 1) return undefined;
  const prev = state.round - 1;
  const merged = loadMerge(base, state.name, prev);
  if (!merged) throw new CliError(`Round ${prev} has no merge result in ${runDir(base, state.name)}. The run folder is incomplete; start a new run.`);
  return priorStateFrom(merged);
}

function roundRecord(state: RunState) {
  let rec = state.rounds.find((r) => r.round === state.round);
  if (!rec) {
    rec = { round: state.round, judges: {} };
    state.rounds.push(rec);
  }
  return rec;
}

function assertOpen(state: RunState): void {
  if (state.closed) throw new CliError(`Run "${state.name}" is closed: ${state.closed}. Start a new run for a new review.`);
}

function cmdInit(run: string, opts: Record<string, string | undefined>, base: string): number {
  if (!opts.rubric || !opts.artifact) throw new CliError('init needs --rubric <file> and --artifact <file>.');
  const rubricPath = resolve(opts.rubric);
  const artifactPath = resolve(opts.artifact);
  if (!existsSync(rubricPath)) throw new CliError(`Rubric file not found: ${rubricPath}`);
  if (!existsSync(artifactPath)) throw new CliError(`Artifact file not found: ${artifactPath}`);
  if (runExists(base, run)) throw new CliError(`Run "${run}" already exists in ${runDir(base, run)}. Pick another name.`);
  const rounds = Number(opts.rounds ?? 3);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new CliError('--rounds must be a whole number from 1 to 10.');

  const rubric = parseRubric(readText(rubricPath));
  const state: RunState = {
    version: STATE_VERSION,
    name: run,
    createdAt: new Date().toISOString(),
    rubricPath: storedPath(base, rubricPath),
    artifactPath: storedPath(base, artifactPath),
    rubric,
    maxRounds: rounds,
    round: 1,
    closed: false,
    rounds: [],
  };
  saveState(base, state);
  console.log(`Run "${run}" created in ${runDir(base, run)}`);
  console.log(`Rubric "${rubric.title}": ${rubric.criteria.length} criteria (${rubric.criteria.map((c) => c.id).join(', ')})`);
  console.log(`Artifact: ${state.artifactPath}`);
  console.log(`Max rounds: ${rounds}`);
  console.log(`Next: agent-jury prompt ${run}   (give the output to a fresh judge)`);
  return EXIT.OK;
}

function cmdPrompt(run: string, opts: Record<string, string | boolean | undefined>, base: string): number {
  const state = loadState(base, run);
  assertOpen(state);
  const judge = judgeId((opts.judge as string | undefined) ?? 'A');
  if (judge === 'B') assertReadyForB(base, state);
  const prompt = buildJudgePrompt({
    rubric: state.rubric,
    artifactPath: state.artifactPath,
    artifactText: opts['path-only'] ? undefined : artifactText(base, state),
    round: state.round,
    maxRounds: state.maxRounds,
    judge,
    prior: priorFor(base, state),
  });
  process.stdout.write(prompt + '\n');
  return EXIT.OK;
}

/** Judge B is the confirmation step: it runs only after judge A passed this round. */
function assertReadyForB(base: string, state: RunState): JudgeVerdict {
  const a = loadJudge(base, state.name, state.round, 'A');
  if (!a) throw new CliError(`Judge B comes after judge A. Record judge A for round ${state.round} first: agent-jury prompt ${state.name}`);
  if (a.verdict !== 'PASS') throw new CliError(`Judge A gave NEEDS_WORK in round ${state.round}. Merge, apply the fixes, and start the next round: agent-jury merge ${state.name}`);
  return a;
}

function readVerdictText(file: string | undefined): string {
  if (file) return readFileSync(resolve(file), 'utf8');
  if (process.stdin.isTTY) throw new CliError('record reads the judge reply from --file <reply> (the saved reply: a fenced JSON block or bare JSON) or from stdin.');
  return readFileSync(0, 'utf8');
}

function cmdRecord(run: string, opts: Record<string, string | undefined>, base: string): number {
  const state = loadState(base, run);
  assertOpen(state);
  const judge = judgeId(opts.judge);
  if (judge === 'B') assertReadyForB(base, state);
  const text = readVerdictText(opts.file);
  if (text.includes('�')) console.error('Warning: the reply contains replacement characters (�); the text was not read as UTF-8. On Windows, pass the reply with --file instead of piping it.');
  const raw = extractJson(text);
  const { verdict, warnings } = validateVerdict(raw, state.rubric, { round: state.round, judge });

  const artifact = artifactText(base, state);
  const notes: string[] = [];
  for (const c of verdict.criteria) {
    if (c.result !== 'FAIL') continue;
    const check = checkEvidence(c.evidence, artifact);
    c.evidenceVerified = check.ok;
    notes.push(`  ${c.id}: evidence ${check.ok ? 'verified' : 'NOT verified'} (${check.why})`);
  }
  verdict.artifactSha256 = sha256(artifact);

  const report = applyRatchet(priorFor(base, state), verdict);

  if (loadJudge(base, run, state.round, judge)) console.error(`Note: judge ${judge} for round ${state.round} was already recorded; overwriting.`);
  saveJudge(base, run, state.round, judge, raw, report.verdict);
  const rec = roundRecord(state);
  rec.judges[judge] = { outcome: report.verdict.verdict, blocked: report.blocked, artifactSha256: verdict.artifactSha256 };
  if (judge === 'A' && removeJudge(base, run, state.round, 'B')) {
    delete rec.judges.B;
    console.error(`Note: judge B for round ${state.round} was recorded against the previous judge A verdict and has been removed. Record judge B again after merging.`);
  }
  saveState(base, state);

  console.log(`Round ${state.round}, judge ${judge}: ${report.verdict.verdict}`);
  for (const c of report.verdict.criteria) console.log(`  ${c.result.padEnd(4)} ${c.id}: ${c.reason}`);
  if (notes.length) console.log(`Evidence check:\n${notes.join('\n')}`);
  if (report.fixed.length) console.log(`Fixed since round ${state.round - 1}: ${report.fixed.join(', ')}`);
  if (report.stillFailing.length) console.log(`Still failing: ${report.stillFailing.join(', ')}`);
  if (report.newWithEvidence.length) console.log(`New, with verified evidence (counted): ${report.newWithEvidence.join(', ')}`);
  if (report.blocked.length) console.log(`Blocked by the anti-ratchet rule (no verified evidence, moved to optional): ${report.blocked.join(', ')}`);
  const fixes = report.verdict.criteria.filter((c) => c.result === 'FAIL' && c.fix);
  if (fixes.length) console.log(`Fixes:\n${fixes.map((c) => `  - ${c.id}: ${c.fix}`).join('\n')}`);
  if (report.verdict.optional.length) console.log(`Optional (never blocks):\n  - ${report.verdict.optional.join('\n  - ')}`);
  for (const w of warnings) console.error(`Warning: ${w}`);
  console.log(`Next: agent-jury merge ${run}`);
  return report.verdict.verdict === 'PASS' ? EXIT.OK : EXIT.NEEDS_WORK;
}

function cmdMerge(run: string, base: string): number {
  const state = loadState(base, run);
  assertOpen(state);
  const a = loadJudge(base, run, state.round, 'A');
  if (!a) throw new CliError(`No judge A recorded for round ${state.round}. Run: agent-jury prompt ${run}, then record the reply.`);
  const b = loadJudge(base, run, state.round, 'B');
  if (a.verdict === 'PASS' && !b) {
    console.log(`Round ${state.round}: judge A passed. Record judge B before merging:`);
    console.log(`  agent-jury prompt ${run} --judge B   (a fresh context, ideally a different model)`);
    console.log(`  agent-jury record ${run} --judge B --file reply.json`);
    return EXIT.WAITING;
  }
  if (b && a.artifactSha256 && b.artifactSha256 && a.artifactSha256 !== b.artifactSha256) {
    console.error('Warning: judges A and B saw different versions of the artifact (the file changed between the two records). Re-run judge B on the current file for a fair merge.');
  }

  const result = mergeRound(state.rubric, state.round, a, b);
  saveMerge(base, run, result);
  roundRecord(state).merged = { outcome: result.outcome, disputed: result.disputed.map((d) => d.id) };

  console.log(`Round ${state.round} merged (${b ? 'judges A and B' : 'judge A only'}): ${result.outcome}`);
  for (const c of result.criteria) console.log(`  ${c.status.padEnd(8)} ${c.id}: ${c.note}`);

  if (result.outcome === 'PASS') {
    state.closed = 'PASS';
    saveState(base, state);
    saveFinal(base, run, { run, outcome: 'PASS', closed: 'PASS', round: state.round, merged: result });
    if (result.optional.length) console.log(`Optional notes for the author:\n  - ${result.optional.join('\n  - ')}`);
    console.log(`PASS after ${state.round} round(s). Final verdict: ${join(runDir(base, run), 'verdict.json')}`);
    return EXIT.OK;
  }

  if (result.outcome === 'DISPUTED') {
    state.closed = 'DISPUTED';
    saveState(base, state);
    saveFinal(base, run, { run, outcome: 'DISPUTED', closed: 'DISPUTED', round: state.round, merged: result });
    console.log('DISPUTED: the judges disagree and the failing side has no evidence the tool could find in the artifact. A human decides:');
    for (const d of result.disputed) {
      console.log(`  ${d.id}`);
      console.log(`    judge A: ${d.a?.result} - ${d.a?.reason}`);
      console.log(`    judge B: ${d.b?.result} - ${d.b?.reason}`);
    }
    return EXIT.DISPUTED;
  }

  // NEEDS_WORK
  if (result.fixes.length) console.log(`Fixes:\n${result.fixes.map((f) => `  - ${f.id} (judge ${f.judge}): ${f.text}`).join('\n')}`);
  if (state.round >= state.maxRounds) {
    state.closed = 'ROUND_LIMIT';
    saveState(base, state);
    saveFinal(base, run, { run, outcome: 'NEEDS_WORK', closed: 'ROUND_LIMIT', round: state.round, merged: result });
    console.log(`Round limit (${state.maxRounds}) reached without PASS. Run closed as ROUND_LIMIT: hand the best version and the open fixes to a human.`);
    return EXIT.ROUND_LIMIT;
  }
  state.round += 1;
  saveState(base, state);
  console.log(`NEEDS_WORK. Apply the fixes to the artifact (point edits, not a rewrite), then:\n  agent-jury prompt ${run}   (round ${state.round})`);
  return EXIT.NEEDS_WORK;
}

function cmdStatus(run: string, base: string, json: boolean): number {
  const state = loadState(base, run);
  if (json) {
    const { rubric, ...rest } = state;
    console.log(JSON.stringify({ ...rest, criteria: rubric.criteria.map((c) => c.id) }, null, 2));
    return EXIT.OK;
  }
  console.log(`Run "${run}": round ${state.round} of ${state.maxRounds}, ${state.closed ? `closed (${state.closed})` : 'open'}`);
  console.log(`Rubric "${state.rubric.title}": ${state.rubric.criteria.map((c) => c.id).join(', ')}`);
  console.log(`Artifact: ${state.artifactPath}`);
  for (const r of state.rounds) {
    const judges = (['A', 'B'] as JudgeId[])
      .filter((j) => r.judges[j])
      .map((j) => `${j}=${r.judges[j]!.outcome}${r.judges[j]!.blocked.length ? ` (blocked: ${r.judges[j]!.blocked.join(', ')})` : ''}`)
      .join(', ');
    console.log(`  round ${r.round}: ${judges || 'no judge yet'}${r.merged ? ` -> ${r.merged.outcome}${r.merged.disputed.length ? ` (disputed: ${r.merged.disputed.join(', ')})` : ''}` : ''}`);
  }
  return EXIT.OK;
}

export function main(argv: string[]): number {
  assertNode();
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      rubric: { type: 'string' },
      artifact: { type: 'string' },
      rounds: { type: 'string' },
      judge: { type: 'string' },
      file: { type: 'string' },
      dir: { type: 'string' },
      'path-only': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, run] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? EXIT.OK : EXIT.USAGE;
  }
  if (!run) throw new CliError(`"${command}" needs a run name.\n\n${USAGE}`);
  const base = resolve(values.dir ?? process.cwd());

  switch (command) {
    case 'init':
      return cmdInit(run, values as Record<string, string | undefined>, base);
    case 'prompt':
      return cmdPrompt(run, values, base);
    case 'record':
      if (!values.judge) throw new CliError('record needs --judge A or --judge B.');
      return cmdRecord(run, values as Record<string, string | undefined>, base);
    case 'merge':
      return cmdMerge(run, base);
    case 'status':
      return cmdStatus(run, base, Boolean(values.json));
    default:
      throw new CliError(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

/** True when this file is the entry point, also through an npm bin shim or a symlink. */
function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** Run the CLI and turn any error into a message and an exit code. */
export function run(argv: string[]): number {
  try {
    return main(argv);
  } catch (err) {
    const e = err as Partial<CliError>;
    console.error(`Error: ${e.message ?? String(err)}`);
    return typeof e.code === 'number' ? e.code : EXIT.USAGE;
  }
}

if (isMain()) process.exitCode = run(process.argv.slice(2));
