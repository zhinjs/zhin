import { runSmokeScenario } from './harness/run-smoke-scenario.js';

// Each scenario is one user-visible loop through real Plugin Runtime code. See ./README.md.
describe('#829 user-experience loop smoke suite', () => {
  it('installs a v1 project, migrates it to v2, boots it, talks to it and reads message diagnostics', async () => {
    const result = await runSmokeScenario('install-migrate-boot-diagnose.mjs', 60_000);
    expect(result.steps).toEqual([
      'install: v1 project with a plugin instance declared in package.json',
      'migrate: unversioned config becomes configVersion 2 without losing values or comments',
      'boot: the migrated configuration starts a real runtime generation',
      'conversation: root command replies with its configured default',
      'conversation: migrated plugin instance still welcomes new members',
      'conversation: permission denial and unmatched text are recorded, not silently dropped',
      'verify: diagnostics API needs a full-scope token',
      'verify: GET /api/messages/diagnostics explains each message without message bodies',
      'verify: one diagnostic can be read back by id and by exact conversation + messageId',
    ]);
    expect(result.stdout).toContain('E2E_SMOKE_INSTALL_MIGRATE_BOOT_DIAGNOSE_OK');
  }, 65_000);

  it('runs a scenario-lab export against the smoke bot and fails on a wrong expectation', async () => {
    const result = await runSmokeScenario('scenario-lab-export.mjs', 100_000);
    expect(result.steps).toHaveLength(3);
    expect(result.stdout).toContain('E2E_SMOKE_SCENARIO_LAB_OK');
  }, 105_000);

  it('applies command cooldown/concurrency and the exact welcome scope, and members see the result', async () => {
    const result = await runSmokeScenario('admission-and-welcome.mjs', 60_000);
    expect(result.steps).toHaveLength(7);
    expect(result.stdout).toContain('E2E_SMOKE_ADMISSION_WELCOME_OK');
  }, 65_000);

  it('creates a natural-time reminder, delivers it on a fake clock and drives the task center API', async () => {
    const result = await runSmokeScenario('reminders-task-center.mjs', 60_000);
    expect(result.steps).toHaveLength(5);
    expect(result.stdout).toContain('E2E_SMOKE_REMINDERS_TASK_CENTER_OK');
  }, 65_000);

  it('holds quiet-hours RSS updates overnight and sends one morning digest', async () => {
    const result = await runSmokeScenario('rss-quiet-hours.mjs', 60_000);
    expect(result.steps).toHaveLength(5);
    expect(result.stdout).toContain('E2E_SMOKE_RSS_QUIET_HOURS_OK');
  }, 65_000);

  it('offers literal choices in the Console form, explains saved vs applied config and rejects an invalid choice', async () => {
    const result = await runSmokeScenario('config-explain-and-enum.mjs', 60_000);
    expect(result.steps).toHaveLength(6);
    expect(result.stdout).toContain('E2E_SMOKE_CONFIG_EXPLAIN_ENUM_OK');
  }, 65_000);
});
