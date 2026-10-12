# agent-jury 0.1.0

agent-jury is a review loop that ends. You give it a rubric (a short list of what the
finished draft must do for its reader) and a draft. A judge is a fresh AI agent that
grades the draft against the rubric. When a judge fails a criterion (an objection), it
must quote the exact words from the draft it objects to. A round is one pass: the judge
grades, you fix, then the next round starts. The loop runs until the draft passes or
reaches the round limit (3 by default).

What is in this release:

- Five commands: `init`, `prompt`, `record`, `merge` and `status`. Requires Node 22.18
  or newer (native TypeScript support, no dependencies).
- The tool never calls a model. `prompt` writes the text you give to a judge, and
  `record` stores the judge's JSON reply. You run the judges in your own agent or chat.
- Anti-ratchet: a new objection on a criterion that passed before counts only when its
  quote is found in the draft.
- The reviewer's boundary: style and taste go to an `optional` list and never block.
- Each fix is tied to the criterion it belongs to (`criteria[].fix`).
- Two judges confirm the final PASS. Judge B is accepted only after judge A has passed
  in the current round, and `merge` warns when the draft changed between the two.
  If they disagree and the failing judge's quote is not found in the draft, the
  criterion is marked DISPUTED and a human decides.
- Run state keeps paths relative to the project folder, so a run folder can be shared.
- Ships as an Agent Skill for Claude Code, Cowork and any agent that reads Agent Skills.
- USE-ANYWHERE.md: the same protocol for assistants without a shell.
- Example rubrics for text, code and design, and a recorded run that shows the loop
  converging with the anti-ratchet rule and drifting without it.

Install with `npx skills add 30Elevate/agent-jury` and run
`agent-jury init <run> --rubric <file> --artifact <file>` in your project.
