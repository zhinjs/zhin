import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
const root = process.cwd();
const text = fs.readFileSync(path.join(root, '.github/workflows/self-delivery-candidate.yml'), 'utf8');
const workflow = parse(text);
it('isolates candidate builds from smoke and gives neither production privileges', () => {
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' });
  expect(Object.keys(workflow.jobs)).toEqual(['build', 'smoke']);
  expect(text).not.toMatch(/secrets\.|:\s*write|environment:/);
  for (const job of Object.values(workflow.jobs) as any[]) {
    expect(job.timeout_minutes ?? job['timeout-minutes']).toBeLessThanOrEqual(45);
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout')) expect(step.with['persist-credentials']).toBe(false);
    }
  }
});
it('loads the smoke wrapper only from the trusted workflow checkout and verifies downloaded bytes before extraction', () => {
  const smoke = workflow.jobs.smoke.steps;
  expect(smoke.find((step: any) => step.uses?.startsWith('actions/checkout')).with).toEqual({ path: 'trusted', 'persist-credentials': false });
  const download = smoke.find((step: any) => step.name?.startsWith('Download'));
  expect(download.run.indexOf('sha256sum --check --strict')).toBeLessThan(download.run.indexOf('archive.extractall'));
  expect(download.run).toContain('Invalid archive members');
  const install = smoke.find((step: any) => step.name?.startsWith('Install'));
  expect(install.env).not.toHaveProperty('GH_TOKEN');
  expect(install.run).toContain('/trusted/scripts/self-delivery-artifacts.mjs smoke');
  expect(install.run).toContain('docker run --rm');
  expect(install.run).toContain('dst=/trusted,readonly');
  expect(install.run).toContain('dst=/artifacts,readonly');
  expect(install.run).not.toContain('docker.sock');
  expect(install.run).not.toContain('build');
  expect(workflow['run-name']).toContain('inputs.artifact_digest');
  expect(workflow['run-name']).toContain('inputs.operation_key');
});
it('packs once and installs immutable local tarballs with lifecycle scripts disabled', () => {
  const pack = fs.readFileSync(path.join(root, 'scripts/self-delivery-artifacts.mjs'), 'utf8');
  expect(pack).toContain('Tarball digest mismatch');
  expect(pack).toContain('Candidate package closure incomplete');
  expect(pack).toContain("'--ignore-scripts'");
  const smoke = fs.readFileSync(path.join(root, 'scripts/self-delivery-installed-smoke.mjs'), 'utf8');
  expect(smoke).toContain("await receive('/hello')");
  expect(smoke).toContain("await receive('/card')");
  expect(smoke).toContain('await runtime.stop()');
  // Do not mislabel the terminal smoke as a tested Sandbox or live LLM execution.
  expect(smoke).not.toContain("sandbox: 'passed'");
});

it('isolates build lifecycle hooks and protects the host uploader from symlinks', () => {
  const build = workflow.jobs.build.steps.find((step: any) => step.name?.startsWith('Build and pack'));
  expect(build.run).toContain('docker run --rm');
  expect(build.run).toContain('dst=/trusted,readonly');
  expect(build.run).toContain('--cap-drop ALL');
  expect(build.run).not.toContain('GITHUB_TOKEN');
  expect(build.run).not.toContain('docker.sock');
  const script = fs.readFileSync(path.join(root, 'scripts/self-delivery-artifacts.mjs'), 'utf8');
  expect(script).toContain('stat.isSymbolicLink()');
  const container = fs.readFileSync(path.join(root, 'scripts/self-delivery-container.Dockerfile'), 'utf8');
  expect(container).toMatch(/FROM node:24-bookworm-slim@sha256:[a-f0-9]{64}/);
});

it('prunes the shared pnpm lockfile before frozen install rather than relying on filters', () => {
  const build = workflow.jobs.build.steps.find((step: any) => step.name?.startsWith('Build and pack'));
  expect(build.run).toContain('turbo --skip-infer prune zhin.js @zhin.js/agent @zhin.js/runtime @zhin.js/satori');
  expect(build.run.indexOf('turbo --skip-infer prune')).toBeLessThan(build.run.indexOf('pnpm install --frozen-lockfile'));
  expect(build.run).toContain('pack /tmp/pruned /artifacts');
  expect(build.run).toContain('dst=/candidate,readonly');
  expect(build.run).not.toContain('pnpm --filter');
  expect(fs.readFileSync(path.join(root, 'scripts/self-delivery-container.Dockerfile'), 'utf8')).toContain('turbo@2.10.7');
});
it('transforms the trusted minimal-bot parameter properties and validates a fresh completion receipt', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/self-delivery-artifacts.mjs'), 'utf8');
  expect(script).toContain("['--experimental-transform-types', 'smoke.mjs']");
  expect(script).toContain('fs.rmSync(receiptPath, { force: true })');
  expect(script).toContain('verifyInstalledSmokeReceipt(receiptPath, process.env.CANDIDATE_SHA, process.env.ARTIFACT_DIGEST)');
});
