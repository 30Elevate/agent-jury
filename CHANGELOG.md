# Changelog

## 0.1.0 - 2026-10-12

First release.

- CLI (`init`, `prompt`, `record`, `merge`, `status`) in TypeScript with no dependencies, running on Node's native TypeScript support (Node 22.18 or newer).
- The three rules in code and tests: anti-ratchet (`record` looks for each objection's quote in the artifact and blocks a new objection it cannot find on a criterion that passed before), the reviewer's boundary (style goes to `optional`, never blocks), and the deterministic merge of two independent judges with `DISPUTED` for a human.
- Each fix is tied to the criterion it belongs to (`criteria[].fix`).
- Judge B is accepted only after judge A has passed in the current round; `merge` warns when the artifact changed between the two.
- Run state keeps paths relative to the project folder, so a run folder can be shared.
- Skill for Claude Code, Cowork and any agent that reads Agent Skills (`npx skills add 30Elevate/agent-jury`), self-contained with the CLI inside the skill folder.
- `USE-ANYWHERE.md`: the same protocol for assistants without a shell.
- Example rubrics for text, code and design.
- A recorded run showing the loop converging with the rule and drifting without it.
