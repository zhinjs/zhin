import { execFileSync } from 'node:child_process';

/**
 * Search tracked and non-ignored untracked repository files without relying on
 * optional runner tools such as ripgrep.
 */
export function gitGrepSource({ repoRoot, pattern, paths, excludeGlobs = [] }) {
  try {
    return execFileSync('git', [
      'grep',
      '-n',
      '-F',
      '--untracked',
      '--exclude-standard',
      '-e',
      pattern,
      '--',
      ...paths,
      ...excludeGlobs.map((glob) => `:(exclude,glob)${glob}`),
    ], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch (error) {
    if (error?.status === 1) return '';
    throw error;
  }
}
