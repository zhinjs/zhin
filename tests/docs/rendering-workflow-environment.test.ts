import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const load = (file: string) => parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));

describe('rendering test environments', () => {
  it.each([['ci', 'test'], ['publish', 'publish']])(
    'sets up fonts before rendering tests in %s', (workflow, job) => {
      const steps = load(`.github/workflows/${workflow}.yml`).jobs[job].steps;
      const checkout = steps.findIndex((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@'));
      const fonts = steps.findIndex((step: { uses?: string }) => step.uses === './.github/actions/setup-rendering-fonts');
      const checks = steps.findIndex((step: { run?: string }) => step.run?.includes('pnpm check:all'));
      expect(checkout).toBeGreaterThanOrEqual(0);
      expect(checks).toBeGreaterThanOrEqual(0);
      expect(fonts).toBeGreaterThan(checkout);
      expect(fonts).toBeLessThan(checks);
      expect(steps[fonts].if).toBeUndefined();
    }
  );

  it('installs Chinese glyph coverage only on Linux', () => {
    const step = load('.github/actions/setup-rendering-fonts/action.yml').runs.steps[0];
    expect(step.if).toBe("runner.os == 'Linux'");
    expect(step.shell).toBe('bash');
    expect(step.run).toContain('fonts-noto-cjk');
  });
});
