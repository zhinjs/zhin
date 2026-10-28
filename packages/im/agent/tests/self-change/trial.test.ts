import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DecisionEventInput } from '../../src/decision-events.js';
import { createHostProtectedPaths } from '../../src/security/host-config-paths.js';
import { SelfChangeStateError, SelfChangeStore } from '../../src/self-change/store.js';
import { checkSelfChangeFiles, runSelfChangeTrial, type SelfChangeTrialResult } from '../../src/self-change/trial.js';

const origin = { platform: 'icqq', sceneId: 'private:42', userId: '42' };
const command = "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({ run: () => 'pong' });\n";

function failures(checks: Awaited<ReturnType<typeof checkSelfChangeFiles>>) {
  return checks.filter(check => check.status === 'failed').map(check => `${check.path}:${check.check}`);
}

describe('checkSelfChangeFiles', () => {
  it('passes well-formed convention files', async () => {
    const checks = await checkSelfChangeFiles([
      { path: 'commands/ping.ts', content: command },
      { path: 'middlewares/log.ts', content: "import { defineMiddleware } from 'zhin.js/middleware';\nconst m = defineMiddleware(async (_m, next) => next());\nexport default m;\n" },
      { path: 'tools/clock.ts', content: "import { defineAgentTool } from '@zhin.js/tool';\nexport default defineAgentTool<{ a: string }>({} as never);\n" },
      { path: 'skills/weather/tools/now/index.ts', content: "import { defineAgentTool } from '@zhin.js/tool';\nexport default defineAgentTool({} as never);\n" },
      { path: 'skills/weather/helpers.ts', content: 'export const x: number = 1;\n' },
      { path: 'skills/weather/SKILL.md', content: '---\nname: weather\ndescription: 天气\n---\n# 天气\n查询天气。\n' },
      { path: 'agents/ops/agent.json', content: '{"name":"ops"}' },
      { path: 'AGENTS.md', content: '# rules\n' },
    ]);
    expect(failures(checks)).toEqual([]);
    expect(checks.filter(check => check.check === 'default_export').map(check => check.path)).toEqual([
      'commands/ping.ts', 'middlewares/log.ts', 'tools/clock.ts', 'skills/weather/tools/now/index.ts',
    ]);
  });

  it('fails syntax errors and strip-only unsupported syntax (same as the production .ts loader)', async () => {
    const checks = await checkSelfChangeFiles([
      { path: 'commands/a.ts', content: "export default defineCommand({ run: () => 'x' );\n" },
      { path: 'commands/b.ts', content: "import { defineCommand } from 'zhin.js/command';\nenum Mode { A }\nexport default defineCommand({ run: () => String(Mode.A) });\n" },
    ]);
    expect(failures(checks)).toEqual(['commands/a.ts:syntax', 'commands/b.ts:syntax']);
    // No shape check on unparsable source.
    expect(checks.some(check => check.path === 'commands/a.ts' && check.check === 'default_export')).toBe(false);
  });

  it('requires the convention default export', async () => {
    const checks = await checkSelfChangeFiles([
      { path: 'commands/none.ts', content: "import { defineCommand } from 'zhin.js/command';\nexport const c = defineCommand({});\n" },
      { path: 'handlers/message/receive.ts', content: 'export default { run() {} };\n' },
    ]);
    expect(checks.filter(check => check.status === 'failed')).toEqual([
      expect.objectContaining({ path: 'commands/none.ts', check: 'default_export', message: 'must default-export defineCommand(...)' }),
      expect.objectContaining({ path: 'handlers/message/receive.ts', check: 'default_export', message: 'default export must be built with defineHandler(...)' }),
    ]);
  });

  it('rejects harness-forbidden imports but ignores them in comments', async () => {
    const checks = await checkSelfChangeFiles([
      { path: 'commands/send.ts', content: `${command}export function x(bot: any) { return bot.$sendMessage({}); }\n` },
      { path: 'commands/koa.ts', content: `import type { Context } from 'koa';\n${command}` },
      { path: 'commands/kernel.ts', content: `import { x } from '@zhin.js/kernel';\n${command}` },
      { path: 'commands/legacy.ts', content: `import { bootstrapNode } from 'zhin.js/node';\n${command}` },
      { path: 'commands/ok.ts', content: `// do not call bot.$sendMessage( here\n/* import 'koa' */\n${command}` },
    ]);
    expect(failures(checks)).toEqual([
      'commands/send.ts:forbidden_import', 'commands/koa.ts:forbidden_import', 'commands/kernel.ts:forbidden_import', 'commands/legacy.ts:forbidden_import',
    ]);
    expect(checks.find(check => check.path === 'commands/legacy.ts' && check.status === 'failed')!.message).toContain('bootstrapNode');
  });

  it('strips comments in linear time and never lets an unclosed /* hide an import', async () => {
    const content = `${command}const s = "/*${'a/*'.repeat(50_000)}";\nimport 'koa';\n`;
    const started = Date.now();
    const checks = await checkSelfChangeFiles([{ path: 'commands/slow.ts', content }]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(failures(checks)).toEqual(['commands/slow.ts:forbidden_import']);
  });

  it('validates SKILL.md and agent.json', async () => {
    const checks = await checkSelfChangeFiles([
      { path: 'skills/weather/SKILL.md', content: '---\nname: other\n---\n# x\n' },
      { path: 'agents/ops/skills/triage/SKILL.md', content: '---\n- not\n- an object\n---\nbody\n' },
      { path: 'agents/ops/agent.json', content: '[1]' },
    ]);
    expect(failures(checks)).toEqual(['skills/weather/SKILL.md:skill', 'agents/ops/skills/triage/SKILL.md:skill', 'agents/ops/agent.json:agent_manifest']);
  });

  it('delegates JSX syntax to the host checker and skips it without one', async () => {
    const component = "import { defineComponent } from 'zhin.js/component';\nexport default defineComponent(() => <text>hi</text>);\n";
    const skipped = await checkSelfChangeFiles([{ path: 'components/hi.tsx', content: component }]);
    expect(skipped.find(check => check.check === 'syntax')).toMatchObject({ status: 'skipped' });
    expect(failures(skipped)).toEqual([]);
    const seen: string[] = [];
    const checked = await checkSelfChangeFiles([{ path: 'components/hi.tsx', content: component }], {
      jsxSyntax: (target) => { seen.push(target); return 'Unexpected "<"'; },
    });
    expect(seen).toEqual(['components/hi.tsx']);
    expect(failures(checked)).toEqual(['components/hi.tsx:syntax']);
  });

  it('resolves convention dirs under a local plugin root', async () => {
    const checks = await checkSelfChangeFiles([{ path: 'plugins/weather/commands/now.ts', content: 'export default 1;\n' }], { pluginRoots: ['plugins/weather'] });
    expect(failures(checks)).toEqual(['plugins/weather/commands/now.ts:default_export']);
  });

  it('clips long messages', async () => {
    const long = await checkSelfChangeFiles([{ path: 'components/x.tsx', content: 'x' }], { jsxSyntax: () => 'e'.repeat(5000) });
    expect(long[0]!.message!.length).toBeLessThanOrEqual(300);
  });
});

describe('runSelfChangeTrial', () => {
  let project: string;
  let events: DecisionEventInput[];
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'zhin-change-trial-'));
    events = [];
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));

  async function store() {
    return new SelfChangeStore({
      root: join(project, '.zhin', 'changes'),
      projectRoot: project,
      protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
      audit: () => ({ record: (input) => { events.push(input); } }),
      now: () => 1_000,
    });
  }

  it('moves a passing draft to ready with the trial bound to its content hash', async () => {
    const changes = await store();
    const draft = await changes.draft({ origin, files: [{ path: 'commands/ping.ts', content: command }] });
    const ready = await runSelfChangeTrial(changes, draft.id, { now: () => 1_000, turnId: 't1' });
    expect(ready.status).toBe('ready');
    const trial = ready.trial as SelfChangeTrialResult;
    expect(trial).toMatchObject({ version: 1, passed: true, contentHash: draft.contentHash, pendingStages: ['plugin_tests', 'sandbox_load'] });
    expect(await changes.readStagedFile(draft.id, 'commands/ping.ts')).toBe(command);
    expect(events.map(event => [event.reasonCode, event.payload?.to])).toEqual([
      ['change_drafted', 'draft'], ['change_drafted', 'trialing'], ['change_trial_passed', 'ready'],
    ]);
    expect(events[2]!.turnId).toBe('t1');
  });

  it('passes config-only changes and deletions without code checks', async () => {
    const changes = await store();
    const draft = await changes.draft({
      origin,
      files: [{ path: 'commands/old.ts', delete: true }],
      configPatch: { expectedRevision: 'r1', patches: [{ op: 'set', path: ['weather', 'unit'], value: 'c' }] },
    });
    const ready = await runSelfChangeTrial(changes, draft.id);
    expect(ready).toMatchObject({ status: 'ready', trial: { passed: true, checks: [] } });
  });

  it('fails into trial_failed, slims the staged files and keeps only change.json', async () => {
    const changes = await store();
    const draft = await changes.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'export default defineCommand(' }] });
    const failed = await runSelfChangeTrial(changes, draft.id);
    expect(failed).toMatchObject({ status: 'trial_failed', slimmed: true, terminalAt: 1_000 });
    expect(failed.error).toContain('commands/ping.ts [syntax]');
    expect(readdirSync(join(project, '.zhin', 'changes', draft.id))).toEqual(['change.json']);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ reasonCode: 'change_trial_failed', outcome: 'error' });
    expect(last.payload).toMatchObject({ failedChecks: [{ path: 'commands/ping.ts', check: 'syntax' }] });
    expect(JSON.stringify(events)).not.toContain('defineCommand(');
  });

  it('a crashing checker fails the trial instead of leaving it in trialing', async () => {
    const changes = await store();
    const draft = await changes.draft({ origin, files: [{ path: 'components/x.tsx', content: 'x' }] });
    const failed = await runSelfChangeTrial(changes, draft.id, { jsxSyntax: () => { throw new Error('boom'); } });
    expect(failed.status).toBe('trial_failed');
    expect(failed.error).toContain('boom');
  });

  it('only trials drafts', async () => {
    const changes = await store();
    const draft = await changes.draft({ origin, files: [{ path: 'commands/ping.ts', content: command }] });
    await runSelfChangeTrial(changes, draft.id);
    await expect(runSelfChangeTrial(changes, draft.id)).rejects.toBeInstanceOf(SelfChangeStateError);
  });
});
