// Module hooks that let the CLI run from inside node_modules.
//
// Node strips TypeScript types on its own for files outside node_modules, but refuses
// to do so for anything installed as a package. This hook strips the types of this
// package's own .ts files with Node's built-in stripper, nothing else.

import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

// Hooks run on their own thread, so the warning filter in bin/agent-jury.mjs does not
// reach here. Node tags its built-in stripper as experimental and would print a warning
// on every run; the API is pinned by "engines" in package.json.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const message = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (message.includes('stripTypeScriptTypes')) return;
  emitWarning.call(process, warning, ...rest);
};

const packageRoot = new URL('../', import.meta.url).href;

export async function load(url, context, nextLoad) {
  if (url.startsWith(packageRoot) && url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    return { format: 'module', source: stripTypeScriptTypes(source, { mode: 'strip' }), shortCircuit: true };
  }
  return nextLoad(url, context);
}
