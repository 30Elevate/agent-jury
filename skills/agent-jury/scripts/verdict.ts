import type { CriterionVerdict, JudgeId, JudgeVerdict, Rubric } from './types.ts';

/**
 * Pull the JSON object out of a judge's reply: any fenced block, bare JSON, or the outermost braces.
 * When several objects parse (a judge that echoed the schema, then answered), the first one with a
 * "criteria" list wins.
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const fence = /```[a-zA-Z]*\s*\n([\s\S]*?)\n\s*```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) candidates.push(m[1]);
  candidates.push(text.trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  const parsedObjects: Record<string, unknown>[] = [];
  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (isRecord(parsed)) parsedObjects.push(parsed);
    } catch {
      // try the next candidate
    }
  }
  const withCriteria = parsedObjects.find((o) => Array.isArray(o.criteria));
  if (withCriteria) return withCriteria;
  if (parsedObjects.length) return parsedObjects[0];
  throw new Error('No JSON object found in the judge output.');
}

/** Drop terminal escape codes and control characters a judge might emit; keep newlines and tabs. */
export function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export interface Expected {
  round: number;
  judge: JudgeId;
}

export interface ValidatedVerdict {
  verdict: JudgeVerdict;
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string, or a list joined into one; anything else is dropped with a warning. */
function asText(v: unknown, field: string, warnings: string[]): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return clean(v).trim() || undefined;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.map((x) => clean(x).trim()).filter(Boolean).join(' | ') || undefined;
  warnings.push(`"${field}" must be a string; got ${Array.isArray(v) ? 'a list' : typeof v}. Ignored.`);
  return undefined;
}

function stringList(v: unknown, field: string, warnings: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    warnings.push(`"${field}" was not a list; ignored.`);
    return [];
  }
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string') {
      if (clean(x).trim()) out.push(clean(x).trim());
    } else if (isRecord(x) && typeof x.text === 'string') {
      out.push(clean(x.text).trim());
    } else {
      warnings.push(`An entry in "${field}" was not a string; ignored.`);
    }
  }
  return out;
}

/**
 * Check a judge's JSON against the rubric and the expected round/judge.
 * The verdict is always derived from the criteria: any FAIL = NEEDS_WORK.
 * Fixes belong to criteria (`criteria[].fix`); a top-level `fixes` list is kept as optional notes.
 */
export function validateVerdict(input: unknown, rubric: Rubric, expected: Expected): ValidatedVerdict {
  const warnings: string[] = [];
  if (!isRecord(input)) throw new Error('Judge output is not a JSON object.');

  if (input.round !== undefined && Number(input.round) !== expected.round) {
    throw new Error(`Judge output says round ${String(input.round)}, but the run is in round ${expected.round}.`);
  }
  const judge = input.judge === undefined ? undefined : String(input.judge).trim().toUpperCase();
  if (judge !== undefined && judge !== expected.judge) {
    throw new Error(`Judge output says judge "${judge}", but you are recording judge ${expected.judge}.`);
  }

  if (!Array.isArray(input.criteria)) throw new Error('"criteria" must be a list.');
  const ids = new Set(rubric.criteria.map((c) => c.id));
  const seen = new Set<string>();
  const criteria: CriterionVerdict[] = [];

  for (const item of input.criteria) {
    if (!isRecord(item)) throw new Error('Each criterion must be an object.');
    if (typeof item.id !== 'string') throw new Error('Each criterion needs a string "id".');
    const id = item.id.trim().toLowerCase();
    if (!ids.has(id)) throw new Error(`Criterion "${id}" is not in the rubric. Rubric ids: ${[...ids].join(', ')}.`);
    if (seen.has(id)) throw new Error(`Criterion "${id}" appears twice.`);
    seen.add(id);
    const result = String(item.result ?? '').trim().toUpperCase();
    if (result !== 'PASS' && result !== 'FAIL') throw new Error(`Criterion "${id}": result must be PASS or FAIL.`);
    const reason = typeof item.reason === 'string' ? clean(item.reason).trim() : '';
    if (!reason) throw new Error(`Criterion "${id}": "reason" is required (one sentence).`);
    const c: CriterionVerdict = { id, result, reason };
    const evidence = asText(item.evidence, `criteria[${id}].evidence`, warnings);
    if (evidence) c.evidence = evidence;
    const fix = asText(item.fix, `criteria[${id}].fix`, warnings);
    if (fix) c.fix = fix;
    if (result === 'FAIL' && !fix) warnings.push(`Criterion "${id}" failed without a "fix". The author has nothing concrete to act on.`);
    if (result === 'PASS' && fix) warnings.push(`Criterion "${id}" passed but carries a "fix"; moved to optional.`);
    if (result === 'PASS' && c.fix) {
      delete c.fix;
    }
    criteria.push(c);
  }

  const missing = rubric.criteria.filter((c) => !seen.has(c.id)).map((c) => c.id);
  if (missing.length) throw new Error(`Judge did not assess: ${missing.join(', ')}. Every criterion needs PASS or FAIL.`);

  const optional = stringList(input.optional, 'optional', warnings);
  const legacyFixes = stringList(input.fixes, 'fixes', warnings);
  if (legacyFixes.length) {
    warnings.push('Top-level "fixes" is not tied to a criterion; kept as optional notes. Put each fix in criteria[].fix.');
    optional.push(...legacyFixes.map((f) => `[unpinned fix] ${f}`));
  }
  for (const item of input.criteria as Record<string, unknown>[]) {
    if (String(item.result ?? '').trim().toUpperCase() === 'PASS' && typeof item.fix === 'string' && clean(item.fix).trim()) {
      optional.push(`[fix on a passed criterion] ${String(item.id).trim().toLowerCase()}: ${clean(item.fix).trim()}`);
    }
  }

  const anyFail = criteria.some((c) => c.result === 'FAIL');
  const derived = anyFail ? 'NEEDS_WORK' : 'PASS';
  if (input.verdict !== undefined && String(input.verdict).toUpperCase() !== derived) {
    warnings.push(`Judge wrote verdict ${String(input.verdict)}, but the criteria say ${derived}. Using ${derived}.`);
  }

  return {
    verdict: { round: expected.round, judge: expected.judge, verdict: derived, criteria, optional },
    warnings,
  };
}
