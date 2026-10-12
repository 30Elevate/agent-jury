// Copies the source files into the skill folder, so the skill works when it is
// installed on its own (npx skills add, Codex and Gemini CLI copy only the skill
// directory, not the whole repo).
//
// Edit the files at the repo root, never the copies under skills/agent-jury/.
//   node scripts/sync-skills.mjs          write the copies
//   node scripts/sync-skills.mjs --check  exit 1 if any copy is out of date

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// [source at repo root, destination inside the skill]. A folder copies every file in it (one level).
const MAP = [
  ['src', 'skills/agent-jury/scripts'],
  ['examples/convergence/README.md', 'skills/agent-jury/references/convergence-example.md'],
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const rel = (p) => relative(root, p).replaceAll('\\', '/');
// Line endings do not count as a difference (Git on Windows may convert them).
const text = (p) => readFileSync(p, 'utf8').replaceAll('\r\n', '\n');

const pairs = MAP.flatMap(([src, dest]) => {
  const from = join(root, src);
  if (!existsSync(from)) return [];
  if (!statSync(from).isDirectory()) return [[from, join(root, dest)]];
  return readdirSync(from)
    .filter((f) => statSync(join(from, f)).isFile())
    .map((f) => [join(from, f), join(root, dest, f)]);
});

const problems = [];
for (const [from, to] of pairs) {
  if (existsSync(to) && text(to) === text(from)) continue;
  if (check) {
    problems.push(`${rel(to)} (out of date)`);
  } else {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text(from), 'utf8');
    console.log(`wrote ${rel(to)}`);
  }
}

if (check) {
  if (problems.length) {
    console.error('Copies out of date:\n  ' + problems.join('\n  ') + '\nRun: node scripts/sync-skills.mjs');
    process.exit(1);
  }
  console.log(`All ${pairs.length} copies are up to date.`);
}
