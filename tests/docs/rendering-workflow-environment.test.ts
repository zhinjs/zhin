import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const load = (file: string) => parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));

describe('rendering test environments', () => {
  it.each([['full-validation', 'checks'], ['publish', 'publish']])(
    'sets up fonts before rendering tests in %s', (workflow, job) => {
      const steps = load(`.github/workflows/${workflow}.yml`).jobs[job].steps;
      const checkout = steps.findIndex((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@'));
      const fonts = steps.findIndex((step: { uses?: string }) => step.uses === './.github/actions/setup-rendering-fonts');
      const checks = steps.findIndex((step: { run?: string }) => step.run?.includes(workflow === 'publish' ? 'pnpm check:created-project' : 'pnpm check:all'));
      expect(checkout).toBeGreaterThanOrEqual(0);
      expect(checks).toBeGreaterThanOrEqual(0);
      expect(fonts).toBeGreaterThan(checkout);
      expect(fonts).toBeLessThan(checks);
      expect(steps[fonts].if).toBeUndefined();
    }
  );

  it('installs Chinese glyph coverage only on Linux, from a cache when possible', () => {
    const [restore, install] = load('.github/actions/setup-rendering-fonts/action.yml').runs.steps;
    expect(restore.if).toBe("runner.os == 'Linux'");
    expect(restore.uses).toMatch(/^actions\/cache@[0-9a-f]{40}$/);
    expect(restore.with.path).toBe('~/.local/share/fonts/noto-cjk');
    expect(install.if).toBe("runner.os == 'Linux'");
    expect(install.shell).toBe('bash');
    expect(install.env.CACHE_HIT).toBe('${{ steps.fonts.outputs.cache-hit }}');
    expect(install.run).toContain('fonts-noto-cjk');
    expect(install.run).toContain('fc-cache');
    // apt-get update only as the fallback when the cached index cannot download the package.
    expect(install.run).toMatch(/apt-get download fonts-noto-cjk \|\| \(sudo apt-get update/);
  });
});
