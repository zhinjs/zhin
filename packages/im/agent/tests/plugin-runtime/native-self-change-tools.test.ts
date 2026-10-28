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

let project: string;
let events: DecisionEventInput[];

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'zhin-change-tool-'));
  events = [];
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

async function harness(impact?: SelfChangeImpactPort) {
  const store = new SelfChangeStore({
    root: join(project, '.zhin', 'changes'),
    projectRoot: project,
    protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    audit: () => ({ record: (input) => { events.push(input); } }),
  });
  const [feature] = createNativeSelfChangeToolFeatures({ store: () => store, impact: () => impact });
  return { store, tool: feature! };
}

function context(subjectId = '42', origin: Partial<Extract<ToolExecutionContext['origin'], { kind: 'im' }>> = {}): ToolExecutionContext {
  return {
    locale: 'zh-CN',
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn-1',
    sessionKey: 'session',
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot-1', scope: 'private', sceneId: '42', ...origin },
    principal: { subjectId, roles: ['user'] },
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
});
