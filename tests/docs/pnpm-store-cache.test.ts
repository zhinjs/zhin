import { readdirSync, readFileSync } from 'node:fs';
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
    expect(source).not.toMatch(/secrets\.|github\.token|NPM_TOKEN/);
    const steps: Step[] = parse(source).runs.steps;
    expect(steps[0].run).toBe('echo "path=$(pnpm store path --silent)" >> "$GITHUB_OUTPUT"');
    const cache = steps[1];
    expect(cache.uses).toBe('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
    expect(cache.with).toEqual({
      path: '${{ steps.store.outputs.path }}',
      key: "pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}",
      'restore-keys': 'pnpm-store-${{ runner.os }}-\nnode-cache-${{ runner.os }}-x64-pnpm-\n',
    });
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
