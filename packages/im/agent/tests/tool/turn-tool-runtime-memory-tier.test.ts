/**
 * #1250 memory-write-needs-approval: the Host's memory_upsert writes the initiator's own `user`
 * memory without approval; shared scopes, unattended turns and look-alike plugin tools keep it.
 */
import { InMemoryMemoryEntryRepository } from '@zhin.js/ai';
import { rootPluginId, type PluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { createNativeSemanticMemoryToolFeatures, SemanticMemoryRuntime } from '../../src/plugin-runtime/native-semantic-memory-tools.js';
import { MEMORY_SCOPE_POLICY } from '../../src/security/policy-facade.js';

type Role = 'owner' | 'member';

function turn(options: { role?: Role; unattended?: boolean; subjectId?: string } = {}) {
  const subjectId = options.subjectId ?? (options.role === 'owner' ? 'owner-1' : 'alice');
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: 'g1' },
    principal: { subjectId, roles: options.role === 'owner' ? ['owner'] : ['user'] },
    input: { text: '记住：我不吃香菜' },
    session: { key: 'qq:bot:group:g1' },
    policy: { permissions: ['user'], unattended: options.unattended ?? false },
    capabilities: { tools: ['memory_upsert'], skills: [] },
    signal: new AbortController().signal,
    // No approval port: anything that still needs approval is denied, never silently run.
    ports: { journal: { append: () => undefined } },
  });
}

function memoryTool(owner: PluginId = rootPluginId()) {
  const repository = new InMemoryMemoryEntryRepository();
  const runtime = new SemanticMemoryRuntime();
  runtime.activate(repository);
  const feature = createNativeSemanticMemoryToolFeatures(runtime).find(entry => entry.name === 'memory_upsert')!;
  const definition = feature.definition;
  const capability: ToolCapability = {
    owner, name: 'memory_upsert', qualifiedName: 'memory_upsert', description: definition.description,
    requiresApproval: definition.requiresApproval, source: '/native/memory.ts',
    execute: (input, invocation) => definition.execute(input as Record<string, unknown>, invocation as never) as never,
  };
  return { repository, capability };
}

describe('memory_upsert approval tier', () => {
  it('writes the initiator\'s own user memory without approval', async () => {
    const { repository, capability } = memoryTool();
    const outcome = await new TurnToolRuntime(turn(), [capability])
      .execute('memory_upsert', { key: 'food', content: '不吃香菜', scope: 'user' }, 't1');
    expect(outcome.status).toBe('completed');
    expect(await repository.find({ scope: 'user', scope_key: 'alice', key: 'food' })).toMatchObject({ content: '不吃香菜' });
  });

  it('defaults a member to user scope, which needs no approval', async () => {
    const { repository, capability } = memoryTool();
    const outcome = await new TurnToolRuntime(turn(), [capability]).execute('memory_upsert', { key: 'food', content: '不吃香菜' }, 't1');
    expect(outcome.status).toBe('completed');
    expect(await repository.find({ scope: 'user', scope_key: 'alice', key: 'food' })).not.toBeNull();
  });

  it('cannot reach another person\'s user memory through model arguments', async () => {
    const { repository, capability } = memoryTool();
    await new TurnToolRuntime(turn(), [capability])
      .execute('memory_upsert', { key: 'food', content: '爱吃香菜', scope: 'user', scope_key: 'bob', subjectId: 'bob' }, 't1');
    expect(await repository.find({ scope: 'user', scope_key: 'bob', key: 'food' })).toBeNull();
    expect(await repository.find({ scope: 'user', scope_key: 'alice', key: 'food' })).not.toBeNull();
  });

  it.each([
    ['global', 'owner'],
    ['platform', 'owner'],
    ['session', 'member'],
  ] as const)('keeps approval for %s memory', async (scope, role) => {
    const { repository, capability } = memoryTool();
    const outcome = await new TurnToolRuntime(turn({ role }), [capability])
      .execute('memory_upsert', { key: 'rule', content: '群规：禁止刷屏', scope }, 't1');
    expect(outcome).toMatchObject({ status: 'denied', policy: MEMORY_SCOPE_POLICY });
    expect((outcome as { reason: string }).reason).toContain('no approval channel');
    expect(await repository.search({ query: '刷屏' })).toEqual([]);
  });

  it('keeps approval for an owner whose default scope is global', async () => {
    const { capability } = memoryTool();
    const outcome = await new TurnToolRuntime(turn({ role: 'owner' }), [capability])
      .execute('memory_upsert', { key: 'food', content: '不吃香菜' }, 't1');
    expect(outcome).toMatchObject({ status: 'denied', policy: MEMORY_SCOPE_POLICY });
  });

  it('keeps approval in an unattended turn, even for user memory', async () => {
    const { repository, capability } = memoryTool();
    const outcome = await new TurnToolRuntime(turn({ unattended: true }), [capability])
      .execute('memory_upsert', { key: 'food', content: '不吃香菜', scope: 'user' }, 't1');
    expect(outcome).toMatchObject({ status: 'denied', policy: MEMORY_SCOPE_POLICY });
    expect(await repository.find({ scope: 'user', scope_key: 'alice', key: 'food' })).toBeNull();
  });

  it('denies an unknown scope instead of asking for approval', async () => {
    const { capability } = memoryTool();
    const outcome = await new TurnToolRuntime(turn(), [capability])
      .execute('memory_upsert', { key: 'food', content: 'x', scope: 'everyone' }, 't1');
    expect(outcome).toMatchObject({ status: 'denied', policy: MEMORY_SCOPE_POLICY });
  });

  it('gives a plugin tool named memory_upsert no personal tier', async () => {
    const { capability } = memoryTool('plugin:evil' as PluginId);
    const outcome = await new TurnToolRuntime(turn(), [capability])
      .execute('memory_upsert', { key: 'food', content: 'x', scope: 'user' }, 't1');
    expect(outcome).toMatchObject({ status: 'denied', policy: 'approval' });
  });

  it('reports a denied write as having side effects', async () => {
    const { capability } = memoryTool();
    const outcome = await new TurnToolRuntime(turn({ role: 'owner' }), [capability])
      .execute('memory_upsert', { key: 'k', content: 'v', scope: 'global' }, 't1');
    expect(outcome).toMatchObject({ status: 'denied', sideEffect: true });
  });
});
