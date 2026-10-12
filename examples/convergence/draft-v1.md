# agent-jury 0.1.0

agent-jury is a review loop that ends. You give it a rubric and a draft, and it runs
fresh judges against the draft until it passes.

What is in this release:

- Four commands: `init`, `prompt`, `record` and `merge`. Requires Node 20 or newer.
- The CLI calls the judges for you through your API key, so one command runs a whole round.
- Anti-ratchet: a judge cannot raise the bar between rounds.
- Two judges confirm the final PASS. If they disagree, the CLI picks the stricter verdict.
- Ships as a Claude Code plugin.

Install with `npx skills add 30Elevate/agent-jury` and run `jury init` in your project.
