# A recorded run: release notes, three rounds, two arms

Real judges, real replies, copied from the run folder as the CLI wrote them. The artifact
is a draft of this project's own release notes for 0.1.0, written with five deliberate
defects (wrong Node version, four commands instead of five, a claim that the CLI calls
models through an API key, a wrong merge rule, missing items). Rubric: `rubric.md`, four
criteria. Judge A ran on one model, judge B on a different, smaller one, each in a fresh
context with read access to the repository so it could check facts.

Two arms, same starting draft, same model as judge A, same round limit (3):

- **with-rule**: the CLI run. The judge in round 2+ receives the prior objections and the
  list of passed criteria (`round-2/prompt-A.md` shows the exact prompt).
- **without-rule**: a fresh judge each round with no memory of the previous round
  (`without-rule/round-2-prompt.md`: same prompt, minus the prior sections). Its fixes
  were applied to its own copy of the draft (`without-rule/draft-v3.md`).

## What happened

| Round | with-rule | without-rule |
|---|---|---|
| 1 (`draft-v1.md`) | A: 4 of 4 FAIL, every quote found in the draft | same judge, same reply |
| 2 (`draft-v2.md`) | A: 3 fixed, `plain` still failing | A: FAIL `facts` (install line) and `plain`, 2 PASS |
| 3 (`draft-v3-final.md`) | A: **PASS**. B: **PASS**. Closed: PASS | A on its own v3: 3 of 4 FAIL, including `no-promises`, which it had passed in round 2 |

Files: `with-rule/round-N/judge-X.raw.json` is the reply as received, `judge-X.json`
the reply after validation and the evidence check, `merge.json` the merged round,
`state.json` and `verdict.json` the run. `without-rule/` holds the other arm's two later
verdicts.

## What it shows, and what it does not

**With the rule, objections went 4, 1, 0.** The round-2 judge checked the prior
objections first, reported three as fixed and one as still open, and the round-3 judges
(A, then B on a different model) passed. Every objection carried a quote that `record`
found in the draft, so the blocking path never fired here; the convergence came from the
prompt putting the prior objections first and the judge working through them.

**Without the rule, objections went 4, 2, 3.** The round-3 judge, seeing a draft that
had just absorbed the round-2 fixes, failed three criteria. One of them, `no-promises`,
had passed in round 2 on nearly the same text; the judge now read the new sentence about
quoting as a promise the code does not keep. Same model, same rubric, no memory: the bar
moved. Under the rule that objection would have needed a quote (it had one) and would
have counted; the difference is that the rule arm never re-opened the question, because
the judge was told what had passed and worked from the open objection.

**The rule does not make judges sharper.** The without-rule judge raised two points that
the with-rule judges let through: the install line implies an `agent-jury` command is on
PATH after `npx skills add` (it is not; that needs the global npm install), and "must
quote" overstates the code, which requires a quote only for a new objection on a
criterion that passed before. Both are right. The final draft in this folder keeps both
imprecisions, because the run is published as it happened. The rule bounds the loop; the
quality of what passes is still the quality of the judges, which is why judge B should
be a different model.

**The blocking path is covered elsewhere.** An objection without a verifiable quote on a
passed criterion never came up in this run. `test/ratchet.test.ts` and
`test/cli.test.ts` exercise it, including a simulated judge that invents one new
objection per round: three counted without the rule, zero with it.

## Reproduce it

```bash
cd examples/convergence
node ../../src/cli.ts init demo --rubric rubric.md --artifact draft-v1.md --rounds 3
node ../../src/cli.ts prompt demo        # give this to a fresh judge
node ../../src/cli.ts record demo --judge A --file reply.json
node ../../src/cli.ts merge demo
```

Your judges will not write the same replies. The mechanism is the same.
