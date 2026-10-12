// Shared types for agent-jury. No runtime code here.

export type Result = 'PASS' | 'FAIL';
export type JudgeId = 'A' | 'B';
export type JudgeOutcome = 'PASS' | 'NEEDS_WORK';
export type FinalOutcome = 'PASS' | 'NEEDS_WORK' | 'DISPUTED';

/** One line of the rubric: an observable effect the artifact must have. */
export interface Criterion {
  id: string;
  text: string;
}

export interface Rubric {
  title: string;
  criteria: Criterion[];
}

/**
 * A judge's call on one criterion.
 * `evidence` quotes the exact place in the artifact. `fix` says what to change, where.
 */
export interface CriterionVerdict {
  id: string;
  result: Result;
  reason: string;
  evidence?: string;
  fix?: string;
  /** Set by `record`: whether `evidence` was found in the artifact. */
  evidenceVerified?: boolean;
}

/** What a judge returns, as one JSON block. */
export interface JudgeVerdict {
  round: number;
  judge: JudgeId;
  verdict: JudgeOutcome;
  criteria: CriterionVerdict[];
  /** Style and taste. Never changes the verdict. */
  optional: string[];
  /** Set by `record`: sha256 of the artifact the judge saw. */
  artifactSha256?: string;
}

/** An objection carried from one round to the next. */
export interface Objection {
  id: string;
  judge: JudgeId;
  reason: string;
  evidence?: string;
  fix?: string;
}

/** What the previous round established, as seen by the next judge. */
export interface PriorState {
  round: number;
  /** Criteria that failed after the merge. */
  objections: Objection[];
  /** Criteria that passed after the merge. */
  passed: string[];
  /** Criteria the judges split on without evidence. Not counted; a new FAIL needs evidence. */
  disputed: string[];
}

/** Result of applying the anti-ratchet rule to a judge's verdict. */
export interface RatchetReport {
  /** The verdict after the rule, with blocked objections moved to `optional`. */
  verdict: JudgeVerdict;
  fixed: string[];
  stillFailing: string[];
  /** New objections on previously passed or disputed criteria, with verified evidence. Counted. */
  newWithEvidence: string[];
  /** New objections without verified evidence. Not counted. */
  blocked: string[];
}

export type CriterionStatus = 'PASS' | 'FAIL' | 'DISPUTED';

export interface MergedCriterion {
  id: string;
  a?: CriterionVerdict;
  b?: CriterionVerdict;
  status: CriterionStatus;
  note: string;
}

export interface Fix {
  id: string;
  judge: JudgeId;
  text: string;
}

export interface MergeResult {
  round: number;
  outcome: FinalOutcome;
  criteria: MergedCriterion[];
  fixes: Fix[];
  optional: string[];
  disputed: MergedCriterion[];
}

export interface FinalVerdict {
  run: string;
  outcome: FinalOutcome;
  closed: 'PASS' | 'DISPUTED' | 'ROUND_LIMIT';
  round: number;
  merged: MergeResult;
}

export interface RoundRecord {
  round: number;
  judges: Partial<Record<JudgeId, { outcome: JudgeOutcome; blocked: string[]; artifactSha256: string }>>;
  merged?: { outcome: FinalOutcome; disputed: string[] };
}

export const STATE_VERSION = 1;

export interface RunState {
  version: typeof STATE_VERSION;
  name: string;
  createdAt: string;
  rubricPath: string;
  artifactPath: string;
  rubric: Rubric;
  maxRounds: number;
  round: number;
  closed: false | 'PASS' | 'DISPUTED' | 'ROUND_LIMIT';
  rounds: RoundRecord[];
}
