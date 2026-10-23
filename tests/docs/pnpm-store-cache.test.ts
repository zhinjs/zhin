import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

/** A dependency install (`pnpm install`, or a filtered `pnpm --filter ... install`), not `pnpm exec playwright install`. */
const INSTALL = /^pnpm (?:--filter \S+ )*install\b/;

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };

const RESTORE_STORE = './.github/actions/restore-pnpm-store';
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflowFiles = readdirSync(new URL('../../.github/workflows/', import.meta.url)).filter(file => file.endsWith('.yml'));

/** Every step list that installs dependencies with pnpm, as `[label, steps]`. */
function installingStepLists(): Array<[string, Step[]]> {
  const lists: Array<[string, Step[]]> = [];
  for (const file of workflowFiles) {
    const config = parse(read(`.github/workflows/${file}`));
    for (const [name, job] of Object.entries<{ steps?: Step[] }>(config.jobs ?? {})) {
      if (job.steps?.some(step => INSTALL.test(step.run ?? ''))) {
        lists.push([`${file} ${name}`, job.steps]);
      }
    }
  }
  lists.push(['prepare-workspace', parse(read('.github/actions/prepare-workspace/action.yml')).runs.steps]);
  return lists;
}

describe('pnpm store cache', () => {
  it('restores the pnpm store with restore-keys, credential-free, through the pinned actions/cache', () => {
    const source = read('.github/actions/restore-pnpm-store/action.yml');
    expect(source).not.toMatch(/secrets\.|github\.token/);
    const steps: Step[] = parse(source).runs.steps;
    expect(steps[0].run).toBe('echo "path=$(pnpm store path --silent)" >> "$GITHUB_OUTPUT"');
    expect(steps[0].env).toEqual({ NPM_TOKEN: '' });
    const cache = steps[1];
    expect(cache.uses).toBe('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
    expect(cache.with).toEqual({
      path: '${{ steps.store.outputs.path }}',
      key: "pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}",
      'restore-keys': 'pnpm-store-${{ runner.os }}-\nnode-cache-${{ runner.os }}-x64-pnpm-\n',
    });
  });

  it.each([undefined, '', 'synthetic-inherited-credential'])('writes one valid cache output with inherited token %s', (inheritedToken) => {
    const directory = mkdtempSync(join(tmpdir(), 'zhin-pnpm-cache-env-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'cache-env-fixture', private: true, packageManager: JSON.parse(read('package.json')).packageManager }));
      writeFileSync(join(directory, '.npmrc'), '//registry.example.invalid/:_authToken=${NPM_TOKEN}\n');
      writeFileSync(join(directory, 'empty-user-config'), '');
      const step: Step = parse(read('.github/actions/restore-pnpm-store/action.yml')).runs.steps[0];
      const outputFile = join(directory, 'github-output');
      const env: NodeJS.ProcessEnv = { ...process.env, NPM_CONFIG_USERCONFIG: join(directory, 'empty-user-config'), GITHUB_OUTPUT: outputFile };
      delete env.NPM_TOKEN;
      if (inheritedToken !== undefined) env.NPM_TOKEN = inheritedToken;
      Object.assign(env, step.env);
      execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run!], {
        cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const output = readFileSync(outputFile, 'utf8');
      expect(output).toMatch(/^path=[^\r\n]+\n$/);
      expect(output).not.toContain('WARN');
      expect(output).not.toContain('synthetic-inherited-credential');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(installingStepLists())('%s restores the store before installing instead of setup-node exact-match caching', (_label, steps) => {
    for (const step of steps) {
      if (step.uses?.startsWith('actions/setup-node@')) expect(step.with).not.toHaveProperty('cache');
    }
    const restore = steps.findIndex(step => step.uses === RESTORE_STORE);
    const setupNode = steps.findIndex(step => step.uses?.startsWith('actions/setup-node@'));
    const install = steps.findIndex(step => INSTALL.test(step.run ?? ''));
    expect(restore).toBeGreaterThan(setupNode);
    expect(restore).toBeLessThan(install);
  });
});
