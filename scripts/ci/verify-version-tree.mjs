import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeOutputs } from './validation-plan.mjs';

/** Reproduce Changesets output, not a branch/title/path allowlist. No lifecycle hooks. */
export function verifyVersionTree({ root, base, head, cli = createRequire(import.meta.url).resolve('@changesets/cli/bin.js') }) {
  if (![base, head].every(ref => /^[a-f0-9]{40}$/.test(ref))) throw new TypeError('Expected immutable commit SHAs');
  const directory = mkdtempSync(join(tmpdir(), 'zhin-version-proof-'));
  const worktree = join(directory, 'project');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let attached = false;
  try {
    git('worktree', 'add', '--detach', worktree, base);
    attached = true;
    symlinkSync(resolve(root, 'node_modules'), join(worktree, 'node_modules'), 'dir');
    // Invoke the installed CLI directly: never execute candidate package scripts.
    execFileSync(process.execPath, [cli, 'version'], {
      cwd: worktree, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', NPM_TOKEN: '', NODE_AUTH_TOKEN: '' },
    });
    unlinkSync(join(worktree, 'node_modules'));
    git('-C', worktree, 'add', '-A');
    const expected = git('-C', worktree, 'write-tree');
    const actual = git('rev-parse', `${head}^{tree}`);
    return { valid: expected === actual, differences: expected === actual ? [] : git('diff', '--name-only', expected, actual).split('\n'), reason: expected === actual
      ? 'Entire candidate tree matches regenerated Changesets output'
      : 'Candidate differs from regenerated Changesets output; complete validation required' };
  } finally {
    if (attached) git('worktree', 'remove', '--force', worktree);
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try { result = verifyVersionTree({ root: process.cwd(), base: process.env.VERSION_BASE, head: process.env.VERSION_HEAD }); }
  catch { result = { valid: false, reason: 'Version reproduction unavailable; complete validation required' }; }
  writeOutputs(result);
  console.log(result.reason);
}
