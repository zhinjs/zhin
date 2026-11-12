import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolExecutionContext } from '@zhin.js/tool';
import type { DecisionEventInput } from '../../src/decision-events.js';
import { SELF_CHANGE_DRAFT_TOOL_NAME, createNativeSelfChangeToolFeatures } from '../../src/plugin-runtime/native-self-change-tools.js';
import { RESERVED_TOOL_NAMES } from '../../src/reserved-tools.js';
import { createHostProtectedPaths } from '../../src/security/host-config-paths.js';
import { SelfChangeConfigKeyError, SelfChangePathError } from '../../src/self-change/policy.js';
import type { SelfChangePreview, SelfChangeImpactPort } from '../../src/self-change/preview.js';
import { SelfChangeStateError, SelfChangeStore } from '../../src/self-change/store.js';
import { SelfChangeApprovals } from '../../src/self-change/approval.js';
import { SelfChangeDraftForbiddenError } from '../../src/self-change/drafters.js';
import { ToolApprovalQueue } from '../../src/security/tool-approval-queue.js';
import { resolveToolHardGateImApproval, type ToolHardGateImApprovalConfig } from '../../src/security/tool-hard-gate.js';

let project: string;
let events: DecisionEventInput[];

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'zhin-change-tool-'));
  events = [];
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

async function harness(
  impact?: SelfChangeImpactPort,
  withApprovals = false,
  restartSupported?: boolean,
  imApproval?: ToolHardGateImApprovalConfig,
) {
  const store = new SelfChangeStore({
    root: join(project, '.zhin', 'changes'),
    projectRoot: project,
    protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    audit: () => ({ record: (input) => { events.push(input); } }),
  });
  const queue = new ToolApprovalQueue();
  const approvals = withApprovals ? new SelfChangeApprovals({ store, queue }) : undefined;
  const [feature] = createNativeSelfChangeToolFeatures({
    store: () => store,
    impact: () => impact,
    approvals: () => approvals,
    ...(restartSupported === undefined ? {} : { restartSupported: () => restartSupported }),
    ...(imApproval ? { imApproval: () => resolveToolHardGateImApproval(imApproval) } : {}),
  });
  return { store, tool: feature!, queue };
}

function context(
  subjectId = '42',
  origin: Partial<Extract<ToolExecutionContext['origin'], { kind: 'im' }>> = {},
  roles: readonly string[] = ['owner'],
): ToolExecutionContext {
  return {
    locale: 'zh-CN',
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn-1',
    sessionKey: 'session',
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot-1', scope: 'private', sceneId: '42', ...origin },
    principal: { subjectId, roles },
    policy: {},
  } as unknown as ToolExecutionContext;
}

const ping = { path: 'commands/ping.ts', content: "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({ run: () => 'pong' });\n" };

describe('change_draft tool', () => {
  it('is safe, never self-approving and reserved', async () => {
    const { tool } = await harness();
    expect(tool.name).toBe(SELF_CHANGE_DRAFT_TOOL_NAME);
    expect(tool.definition.risk).toBe('safe');
    expect(tool.definition.requiresApproval).toBe('never');
    expect(RESERVED_TOOL_NAMES).toContain('change_draft');
  });

  it('stages a draft with a preview and never touches production', async () => {
    const impact: SelfChangeImpactPort = {
      hostConfigKeys: ['http'],
      planFiles: () => ({ kind: 'generation', reasons: ['untracked source changed in root'], subtrees: [], slots: [], fallbacks: [{ source: 'x', owners: ['root'] }] }),
    };
    const { store, tool } = await harness(impact);
    const result = await tool.definition.execute({ files: [ping], summary: '加 /ping 指令' }, context());
    expect(result).toContain('NOT live');
    expect(result).toContain('passed the static trial run');
    expect(result).toContain('create commands/ping.ts (+2 -0)');
    expect(result).toContain('hot reload — 1 plugin(s): root');
    expect(existsSync(join(project, 'commands', 'ping.ts'))).toBe(false);
    const [record] = await store.list();
    expect(record).toMatchObject({ status: 'ready', trial: { passed: true, contentHash: record!.contentHash }, origin: { platform: 'icqq', sceneId: 'private:42', userId: '42', endpoint: 'bot-1' } });
    const plan = record!.plan as SelfChangePreview;
    expect(plan).toMatchObject({ version: 1, contentHash: record!.contentHash, summary: '加 /ping 指令' });
    expect(plan.files).toEqual([expect.objectContaining({ path: 'commands/ping.ts', kind: 'create', added: 2 })]);
    expect(plan.impact).toMatchObject({ kind: 'generation', subtrees: ['root'] });
    expect(events.map(event => event.reasonCode)).toEqual(['change_drafted', 'change_drafted', 'change_trial_passed']);
  });

  it('closes a trialed change to edits; another call starts a new change', async () => {
    mkdirSync(join(project, 'commands'), { recursive: true });
    writeFileSync(join(project, 'commands', 'ping.ts'), 'old\n');
    const { store, tool } = await harness();
    await tool.definition.execute({ files: [ping], summary: 'v1' }, context());
    const [first] = await store.list();
    expect(first!.status).toBe('ready');
    await expect(tool.definition.execute({ change_id: first!.id, files: [ping], summary: 'v2' }, context())).rejects.toBeInstanceOf(SelfChangeStateError);
    await expect(tool.definition.execute({ change_id: first!.id, files: [ping], summary: 'theirs' }, context('99'))).rejects.toBeInstanceOf(SelfChangeStateError);
    const result = await tool.definition.execute({ files: [{ ...ping, content: `${ping.content}// v2\n` }], summary: 'v2' }, context());
    expect(result).toContain('modify commands/ping.ts');
    expect((await store.list()).map(record => record.status)).toEqual(['ready', 'ready']);
  });

  it('returns trial errors to the model and closes the failed change without an approval', async () => {
    const { store, tool } = await harness();
    const result = await tool.definition.execute({
      files: [{ path: 'commands/ping.ts', content: "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({ run: () => 'pong' );\n" }],
      summary: 'broken',
    }, context());
    expect(result).toContain('FAILED its trial run');
    expect(result).toContain('commands/ping.ts [syntax]');
    expect(result).toContain('WITHOUT change_id');
    const [record] = await store.list();
    expect(record).toMatchObject({ status: 'trial_failed', slimmed: true });
    expect(await store.readStagedFile(record!.id, 'commands/ping.ts')).toBeNull();
    expect(events.map(event => event.reasonCode)).toEqual(['change_drafted', 'change_drafted', 'change_trial_failed']);
    expect(existsSync(join(project, 'commands', 'ping.ts'))).toBe(false);
  });

  it('decodes value_json for field-level config patches and rejects security keys', async () => {
    const { store, tool } = await harness({ hostConfigKeys: ['http'], planFiles: () => ({ kind: 'none', reasons: [] }) });
    const result = await tool.definition.execute({
      config_patch: { expected_revision: 'rev-1', patches: [{ op: 'set', path: ['weather', 'unit'], value_json: '"celsius"' }] },
      summary: '温度单位改摄氏度',
    }, context());
    expect(result).toContain('config: set weather.unit');
    const [record] = await store.list();
    expect(record!.configPatch).toEqual({ expectedRevision: 'rev-1', patches: [{ op: 'set', path: ['weather', 'unit'], value: 'celsius' }] });
    expect((record!.plan as SelfChangePreview).impact).toMatchObject({ kind: 'generation', subtrees: ['weather'] });

    await expect(tool.definition.execute({
      config_patch: { expected_revision: 'rev-1', patches: [{ op: 'set', path: ['ai', 'agent', 'execApprovalMode'], value_json: '"bypass"' }] },
      summary: 'x',
    }, context())).rejects.toBeInstanceOf(SelfChangeConfigKeyError);
    await expect(tool.definition.execute({
      config_patch: { expected_revision: 'rev-1', patches: [{ op: 'set', path: ['weather'], value_json: '{bad' }] },
      summary: 'x',
    }, context())).rejects.toThrow('not valid JSON');
    expect(events.map(event => event.reasonCode)).toContain('change_config_key_forbidden');
  });

  it('refuses protected and out-of-scope targets before writing', async () => {
    const { store, tool } = await harness();
    await expect(tool.definition.execute({ files: [{ path: 'pnpm-lock.yaml', content: 'x' }], summary: 'x' }, context())).rejects.toBeInstanceOf(SelfChangePathError);
    await expect(tool.definition.execute({ files: [{ path: 'zhin.config.yml', content: 'x' }], summary: 'x' }, context())).rejects.toBeInstanceOf(SelfChangePathError);
    expect(await store.list()).toEqual([]);
    expect(events.map(event => event.reasonCode)).toEqual(['change_path_forbidden', 'change_path_forbidden']);
  });

  it('only runs in an IM conversation with a known requester', async () => {
    const { tool } = await harness();
    const http = { ...context(), origin: { kind: 'http', sessionId: 's' } } as unknown as ToolExecutionContext;
    await expect(tool.definition.execute({ files: [ping], summary: 'x' }, http)).rejects.toThrow('IM conversation');
    await expect(tool.definition.execute({ files: [ping], summary: 'x' }, context(''))).rejects.toThrow('known requester');
  });

  it('submits a passing change for approval and refuses a second one while it waits', async () => {
    const { store, tool, queue } = await harness(undefined, true);
    const result = await tool.definition.execute({ files: [ping], summary: '加 /ping 指令' }, context('42', { scope: 'group', sceneId: '500' }));
    const [record] = await store.list();
    expect(record).toMatchObject({ status: 'pending' });
    const [card] = queue.list();
    expect(card).toMatchObject({ category: 'self', toolName: 'self_change', origin: { scope: 'group', sceneId: '500' }, args: { changeId: record!.id } });
    expect(result).toContain(`Submitted for approval (card ${card!.id})`);
    expect(result).toContain('never in a group');

    const second = await tool.definition.execute({ files: [{ ...ping, path: 'commands/pong.ts' }], summary: 'again' }, context('42', { scope: 'group', sceneId: '500' }));
    expect(second).toContain(`Change ${record!.id} from this conversation is still waiting`);
    expect(await store.list()).toHaveLength(1);
  });
  describe('who may draft (#1051 F4)', () => {
    const approvers: ToolHardGateImApprovalConfig = { enabled: true, approverIds: { icqq: ['7'] } };
    const group = { scope: 'group' as const, sceneId: '500' };

    function visible(tool: Awaited<ReturnType<typeof harness>>['tool'], ctx: ToolExecutionContext): boolean {
      return tool.definition.isAvailable?.({ sessionKey: ctx.sessionKey, origin: ctx.origin, principal: ctx.principal }) ?? true;
    }

    it('shows the tool only to the master and IM approvers', async () => {
      const { tool } = await harness(undefined, false, undefined, approvers);
      expect(visible(tool, context('42'))).toBe(true);
      expect(visible(tool, context('42', group))).toBe(true);
      expect(visible(tool, context('7', group, ['user']))).toBe(true);
      expect(visible(tool, context('99', group, ['user', 'admin']))).toBe(false);
      expect(visible(tool, context('99', {}, ['trusted']))).toBe(false);
      expect(visible(tool, context('7', { platform: 'qq' }, ['user']))).toBe(false);
      // 静态查询没有发起人：不可见。
      expect(tool.definition.isAvailable?.({ sessionKey: 's', origin: context().origin })).toBe(false);
    });

    it('ignores approverIds while the IM approval channel is off', async () => {
      const { tool } = await harness(undefined, false, undefined, { ...approvers, enabled: false });
      expect(visible(tool, context('7', group, ['user']))).toBe(false);
      expect(visible(tool, context('42'))).toBe(true);
    });

    it('refuses a group member or stranger who calls it anyway and audits change_draft_forbidden', async () => {
      const { store, tool } = await harness(undefined, true, undefined, approvers);
      await expect(tool.definition.execute({ files: [ping], summary: 'x' }, context('99', group, ['user', 'member'])))
        .rejects.toBeInstanceOf(SelfChangeDraftForbiddenError);
      await expect(tool.definition.execute({ files: [ping], summary: 'x' }, context('99', {}, ['user'])))
        .rejects.toBeInstanceOf(SelfChangeDraftForbiddenError);
      expect(await store.list()).toEqual([]);
      expect(events).toEqual([
        expect.objectContaining({ kind: 'self_change', outcome: 'deny', reasonCode: 'change_draft_forbidden', userId: '99', actorId: '99', sceneId: 'group:500', turnId: 'turn-1' }),
        expect.objectContaining({ kind: 'self_change', outcome: 'deny', reasonCode: 'change_draft_forbidden', userId: '99', sceneId: 'private:42' }),
      ]);
    });

    it('lets an IM approver draft and submit', async () => {
      const { store, tool } = await harness(undefined, true, undefined, approvers);
      const result = await tool.definition.execute({ files: [ping], summary: '加 /ping 指令' }, context('7', group, ['user']));
      expect(result).toContain('Submitted for approval');
      expect((await store.list())[0]).toMatchObject({ status: 'pending', origin: { userId: '7' } });
    });

    it('without IM approval settings only the master may draft', async () => {
      const { tool } = await harness(undefined, true);
      await expect(tool.definition.execute({ files: [ping], summary: 'x' }, context('7', group, ['user'])))
        .rejects.toBeInstanceOf(SelfChangeDraftForbiddenError);
      await expect(tool.definition.execute({ files: [ping], summary: 'x' }, context('42', group))).resolves.toContain('Submitted for approval');
    });

    it('stops drafting once 3 changes wait for approval across the instance', async () => {
      const { store, tool, queue } = await harness(undefined, true);
      for (const sceneId of ['501', '502', '503']) {
        const result = await tool.definition.execute({ files: [ping], summary: sceneId }, context('42', { scope: 'group', sceneId }));
        expect(result).toContain('Submitted for approval');
      }
      const fourth = await tool.definition.execute({ files: [ping], summary: '504' }, context('42', { scope: 'group', sceneId: '504' }));
      expect(fourth).toContain('3 changes to this bot are already waiting');
      expect(fourth).toContain('at most 3 at a time');
      expect((await store.list()).map(record => record.status)).toEqual(['pending', 'pending', 'pending']);
      expect(queue.list()).toHaveLength(3);
      expect(events.at(-1)).toMatchObject({ outcome: 'deny', reasonCode: 'change_pending_cap_reached', sceneId: 'group:504', payload: { pending: 3, limit: 3 } });
    });
  });

  describe('without a supervisor to restart (#1051 F1)', () => {
    const hostConfigImpact: SelfChangeImpactPort = { hostConfigKeys: ['http'], planFiles: () => ({ kind: 'none', reasons: [] }) };
    const portPatch = { expected_revision: 'rev-1', patches: [{ op: 'set', path: ['http', 'port'], value_json: '8087' }] };

    it('keeps a change that needs a restart at ready and does not submit it', async () => {
      const { store, tool, queue } = await harness(hostConfigImpact, true, false);
      const result = await tool.definition.execute({ config_patch: portPatch, summary: '改端口' }, context());
      expect(result).toContain('Not submitted for approval');
      expect(result).toContain('without a supervisor');
      expect(result).toContain('restart');
      const [record] = await store.list();
      expect(record).toMatchObject({ status: 'ready' });
      expect(queue.list()).toEqual([]);
      expect(events.map(event => event.reasonCode)).toContain('change_restart_unavailable');
    });

    it('still submits a hot-reload change', async () => {
      const { store, tool, queue } = await harness(undefined, true, false);
      const result = await tool.definition.execute({ files: [ping], summary: '加 /ping 指令' }, context());
      expect(result).toContain('Submitted for approval');
      expect((await store.list())[0]).toMatchObject({ status: 'pending' });
      expect(queue.list()).toHaveLength(1);
    });

    it('submits a change that needs a restart when a supervisor can restart it', async () => {
      const { store, tool } = await harness(hostConfigImpact, true, true);
      const result = await tool.definition.execute({ config_patch: portPatch, summary: '改端口' }, context());
      expect(result).toContain('Submitted for approval');
      expect((await store.list())[0]).toMatchObject({ status: 'pending' });
    });
  });
});
