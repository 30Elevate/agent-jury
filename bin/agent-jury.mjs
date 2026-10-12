#!/usr/bin/env node
// Entry point for `npm install -g github:30Elevate/agent-jury`.
// Registers the type-stripping hook, then runs the CLI from src/.

import { register } from 'node:module';

// Node tags its built-in type stripper as experimental and prints a warning on every run.
// The API is pinned by "engines" in package.json; the warning adds nothing for a CLI user.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const message = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (message.includes('stripTypeScriptTypes')) return;
  emitWarning.call(process, warning, ...rest);
};

register('./ts-hooks.mjs', import.meta.url);

const { run } = await import('../src/cli.ts');
process.exitCode = run(process.argv.slice(2));
