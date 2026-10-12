import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Node refuses to strip types from .ts files under node_modules. The bin launcher must
// still work when the package is installed, so this test packs and installs it for real.
test('the package installs with npm and the agent-jury bin runs from node_modules', { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-jury-install-'));
  const pack = spawnSync(npm, ['pack', '--pack-destination', dir, '--silent'], { cwd: repo, encoding: 'utf8', shell: true });
  assert.equal(pack.status, 0, pack.stderr);
  const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  assert.ok(tgz, 'npm pack produced no tarball');

  const install = spawnSync(npm, ['install', '--silent', '--no-audit', '--no-fund', join(dir, tgz)], { cwd: dir, encoding: 'utf8', shell: true });
  assert.equal(install.status, 0, install.stderr);

  const bin = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'agent-jury.cmd' : 'agent-jury');
  const help = spawnSync(bin, ['--help'], { cwd: dir, encoding: 'utf8', shell: true });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /agent-jury - a review loop that ends/);

  const missing = spawnSync(bin, ['status', 'nope'], { cwd: dir, encoding: 'utf8', shell: true });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No run "nope"/);
});
