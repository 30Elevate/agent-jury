import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STATE_VERSION } from './types.ts';
import type { FinalVerdict, JudgeId, JudgeVerdict, MergeResult, RunState } from './types.ts';

export const DIR_NAME = '.agent-jury';

const RUN_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
/** Names Windows reserves for devices; a folder with one of them breaks on older systems. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function assertRunName(name: string): void {
  if (!RUN_NAME.test(name) || name.includes('..')) throw new Error(`Run name "${name}" must be letters, digits, ".", "_" or "-" (max 64).`);
  if (RESERVED.test(name)) throw new Error(`Run name "${name}" is reserved on Windows. Pick another name.`);
}

export function runDir(base: string, run: string): string {
  assertRunName(run);
  return join(resolve(base), DIR_NAME, run);
}

function roundDir(base: string, run: string, round: number): string {
  return join(runDir(base, run), `round-${round}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Write to a temporary file, then rename: a crash never leaves a half-written file behind. */
function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function statePath(base: string, run: string): string {
  return join(runDir(base, run), 'state.json');
}

export function runExists(base: string, run: string): boolean {
  return existsSync(statePath(base, run));
}

export function loadState(base: string, run: string): RunState {
  const p = statePath(base, run);
  if (!existsSync(p)) throw new Error(`No run "${run}" in ${join(resolve(base), DIR_NAME)}. Create it with: agent-jury init ${run} --rubric <file> --artifact <file>`);
  const state = readJson<Partial<RunState>>(p);
  if (state.version !== STATE_VERSION) {
    throw new Error(`${p} has state version ${String(state.version)}; this CLI reads version ${STATE_VERSION}. Start a new run.`);
  }
  for (const field of ['name', 'rubric', 'artifactPath', 'maxRounds', 'round', 'rounds'] as const) {
    if (state[field] === undefined) throw new Error(`${p} is missing "${field}". Start a new run.`);
  }
  return state as RunState;
}

export function saveState(base: string, state: RunState): void {
  writeJson(statePath(base, state.name), state);
}

export function judgePath(base: string, run: string, round: number, judge: JudgeId, raw = false): string {
  return join(roundDir(base, run, round), `judge-${judge}${raw ? '.raw' : ''}.json`);
}

export function saveJudge(base: string, run: string, round: number, judge: JudgeId, raw: unknown, adjusted: JudgeVerdict): void {
  writeJson(judgePath(base, run, round, judge, true), raw);
  writeJson(judgePath(base, run, round, judge), adjusted);
}

/** Remove a recorded judge (used when judge A is re-recorded after judge B: B's verdict is stale). */
export function removeJudge(base: string, run: string, round: number, judge: JudgeId): boolean {
  let removed = false;
  for (const raw of [false, true]) {
    const p = judgePath(base, run, round, judge, raw);
    if (existsSync(p)) {
      rmSync(p);
      removed = true;
    }
  }
  return removed;
}

export function loadJudge(base: string, run: string, round: number, judge: JudgeId): JudgeVerdict | undefined {
  const p = judgePath(base, run, round, judge);
  return existsSync(p) ? readJson<JudgeVerdict>(p) : undefined;
}

export function mergePath(base: string, run: string, round: number): string {
  return join(roundDir(base, run, round), 'merge.json');
}

export function saveMerge(base: string, run: string, result: MergeResult): void {
  writeJson(mergePath(base, run, result.round), result);
}

export function loadMerge(base: string, run: string, round: number): MergeResult | undefined {
  const p = mergePath(base, run, round);
  return existsSync(p) ? readJson<MergeResult>(p) : undefined;
}

export function saveFinal(base: string, run: string, value: FinalVerdict): void {
  writeJson(join(runDir(base, run), 'verdict.json'), value);
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}
