import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const read = (name: string) => {
  const source = readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
  return { source, config: parse(source) };
};

describe('untrusted candidate CI credential isolation', () => {
  it.each([['ci', 'test'], ['plugin-runtime-size', 'production-install']])('%s uses only an ephemeral read-only package credential during script-free install', (file, jobName) => {
    const { config, source } = read(file);
    const job = config.jobs[jobName];
    expect(config.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({ contents: 'read', packages: 'read' });
    expect(source).not.toMatch(/secrets\.|PERSONAL_TOKEN|CODECOV_TOKEN/);
    expect(config.env?.NPM_TOKEN ?? job.env?.NPM_TOKEN).toBe('');
    const install = job.steps.find((step: { name: string }) => step.name === 'install dependencies');
    expect(install.run).toBe('pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile');
    expect(install.env).toEqual({ NPM_TOKEN: '${{ github.token }}' });
    const installIndex = job.steps.indexOf(install);
    expect(job.steps[installIndex + 1].run).toBe('pnpm rebuild');
    for (const step of job.steps) {
      if (step !== install) expect(JSON.stringify(step.env ?? {})).not.toMatch(/github\.token|secrets\./);
      if (step.uses?.startsWith('actions/checkout@')) expect(step.with['persist-credentials']).toBe(false);
      expect(step.run ?? '').not.toMatch(/(?:echo|printf|Set-Content|Add-Content).*\.npmrc/);
    }
  });
  it('preserves all six protected CI check identities and repository npm placeholders', () => {
    const { config } = read('ci');
    expect(Object.keys(config.jobs)).toEqual(['test']);
    expect(config.jobs.test.name).toBeUndefined();
    const matrix = config.jobs.test.strategy.matrix;
    expect(matrix.os.flatMap((os: string) => matrix['node-version'].map((node: number) => `test (${os}, ${node})`))).toEqual([
      'test (ubuntu-latest, 22)', 'test (ubuntu-latest, 24)', 'test (ubuntu-latest, 26)',
      'test (windows-latest, 22)', 'test (windows-latest, 24)', 'test (windows-latest, 26)',
    ]);
    expect(readFileSync(new URL('../../.npmrc', import.meta.url), 'utf8')).toContain('//npm.pkg.github.com/:_authToken=${NPM_TOKEN}');
  });
});
