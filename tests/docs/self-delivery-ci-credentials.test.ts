import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const read = (name: string) => {
  const source = readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
  return { source, config: parse(source) };
};

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };

/**
 * The only step allowed to see `github.token`: the last step of a credentialed CI job,
 * run only after a failure, cancelling the rest of the run (fail fast across jobs).
 */
const CANCEL_STEP = {
  name: 'cancel the rest of this run',
  if: 'failure()',
  run: 'gh run cancel ${{ github.run_id }} --repo ${{ github.repository }}',
  env: { GH_TOKEN: '${{ github.token }}' },
};
/** CI jobs that receive the package credential; each may also cancel the run on failure. */
const CI_CREDENTIAL_PERMISSIONS = { contents: 'read', packages: 'read', actions: 'write' };
/** Jobs that install through `prepare-workspace` instead of an inline install step. */
const PREPARED_JOBS = ['checks', 'package-verify', 'docs'];
const PREPARE_WORKSPACE = './.github/actions/prepare-workspace';

function expectNoCredentialOutside(steps: Step[], allowed: readonly Step[]) {
  for (const step of steps) {
    if (!allowed.includes(step)) expect(JSON.stringify(step.env ?? {})).not.toMatch(/github\.token|secrets\./);
    if (step.uses?.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials']).toBe(false);
    expect(step.run ?? '').not.toMatch(/(?:echo|printf|Set-Content|Add-Content).*\.npmrc/);
  }
}

function expectCancelOnlyAsLastStep(steps: Step[]) {
  const cancels = steps.filter(step => step.name === CANCEL_STEP.name || /gh run cancel|github\.token/.test(JSON.stringify(step)));
  expect(cancels).toEqual([steps.at(-1)]);
  expect(steps.at(-1)).toEqual(CANCEL_STEP);
}

describe('untrusted candidate CI credential isolation', () => {
  it.each([['full-validation', 'test'], ['full-validation', 'platform-installed'], ['plugin-runtime-size', 'production-install']])('%s exposes the dedicated package secret only during script-free install', (file, jobName) => {
    const { config, source } = read(file);
    const job = config.jobs[jobName];
    expect(config.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual(file === 'full-validation' ? CI_CREDENTIAL_PERMISSIONS : { contents: 'read', packages: 'read' });
    expect(source).not.toMatch(/secrets\.(?!PERSONAL_TOKEN\b)|secrets\[['"]|CODECOV_TOKEN/);
    // ci: the inline installs of `test` and `platform-installed`, plus one `prepare-workspace` input per prepared job.
    expect(source.match(/secrets\.PERSONAL_TOKEN/g)).toHaveLength(file === 'full-validation' ? 2 + PREPARED_JOBS.length : 2);
    expect(config.env?.NPM_TOKEN ?? job.env?.NPM_TOKEN).toBe('');
    const install = job.steps.find((step: Step) => step.name === 'install dependencies');
    expect(install.run).toBe('pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile');
    expect(install.env).toEqual({ NPM_TOKEN: '${{ secrets.PERSONAL_TOKEN }}' });
    const installIndex = job.steps.indexOf(install);
    expect(job.steps[installIndex + 1].run).toBe('pnpm rebuild');
    if (file === 'full-validation') {
      expectCancelOnlyAsLastStep(job.steps);
      expectNoCredentialOutside(job.steps, [install, job.steps.at(-1)]);
    } else {
      expectNoCredentialOutside(job.steps, [install]);
    }
  });

  it.each(PREPARED_JOBS)('ci %s receives the package secret only as the prepare-workspace input', (jobName) => {
    const { config } = read('full-validation');
    const job = config.jobs[jobName];
    expect(job.permissions).toEqual(CI_CREDENTIAL_PERMISSIONS);
    expect(job.env).toBeUndefined();
    const prepares = job.steps.filter((step: Step) => step.uses === PREPARE_WORKSPACE);
    expect(prepares).toHaveLength(1);
    expect(prepares[0].with).toEqual({ 'npm-token': '${{ secrets.PERSONAL_TOKEN }}' });
    expect(job.steps.filter((step: Step) => step !== prepares[0] && /secrets\./.test(JSON.stringify(step)))).toEqual([]);
    expectCancelOnlyAsLastStep(job.steps);
    expectNoCredentialOutside(job.steps, [job.steps.at(-1)]);
  });

  it('prepare-workspace hands the package secret only to the script-free install', () => {
    const source = readFileSync(new URL(`../../.github/actions/prepare-workspace/action.yml`, import.meta.url), 'utf8');
    const action = parse(source);
    expect(source).not.toMatch(/secrets\.|github\.token/);
    const steps: Step[] = action.runs.steps;
    const users = steps.filter(step => JSON.stringify(step).includes('inputs.npm-token'));
    expect(users).toHaveLength(1);
    const [install] = users;
    expect(install.run).toBe('pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile');
    expect(install.env).toEqual({ NPM_TOKEN: '${{ inputs.npm-token }}' });
    expect(steps[steps.indexOf(install) + 1]!.run).toBe('pnpm rebuild');
    for (const step of steps) {
      expect(step.run ?? '').not.toMatch(/(?:echo|printf|Set-Content|Add-Content).*\.npmrc/);
    }
  });

  it('preserves the protected matrix identities and isolated live-database gate', () => {
    const { config } = read('full-validation');
    expect(Object.keys(config.jobs)).toEqual(['platform-installed', 'database-live', 'test', ...PREPARED_JOBS]);
    expect(config.jobs['platform-installed'].strategy.matrix.platform).toEqual(['onebot11', 'napcat', 'telegram', 'qq']);
    expect(config.jobs['platform-installed'].strategy['fail-fast']).toBe(true);
    expect(config.jobs['database-live'].permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify(config.jobs['database-live'])).not.toMatch(/secrets\.|github\.token|gh run cancel/);
    expect(config.jobs['database-live'].services).toMatchObject({
      mysql: { image: 'mysql:8.4' },
      postgres: { image: 'postgres:17' },
      mongodb: { image: 'mongo:7' },
      redis: { image: 'redis:8' },
    });
    expect(config.jobs.test.name).toBeUndefined();
    const matrix = config.jobs.test.strategy.matrix;
    expect(matrix.os.flatMap((os: string) => matrix['node-version'].map((node: number) => `test (${os}, ${node})`))).toEqual([
      'test (ubuntu-latest, 22)', 'test (ubuntu-latest, 24)', 'test (ubuntu-latest, 26)',
      'test (windows-latest, 22)', 'test (windows-latest, 24)', 'test (windows-latest, 26)',
    ]);
    expect(readFileSync(new URL('../../.npmrc', import.meta.url), 'utf8')).toContain('//npm.pkg.github.com/:_authToken=${NPM_TOKEN}');
  });
});
