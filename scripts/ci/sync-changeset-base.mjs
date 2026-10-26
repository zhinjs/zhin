import { execFileSync } from 'node:child_process';

// Changesets needs a local main even for manually selected branches or detached
// candidates. Never fetch into checked-out main: it identifies the tested commit.
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (branch !== 'main') {
  execFileSync('git', ['fetch', 'origin', 'refs/heads/main:refs/heads/main'], { stdio: 'inherit' });
}
