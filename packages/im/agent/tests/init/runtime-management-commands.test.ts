import { describe, it, expect, vi } from 'vitest';
import { CommandIndex, commandFeatureId } from '@zhin.js/core/feature/command';
import { executeInboundTurnSpine, inboundOutcomeSink, MessageDispatcher, type Message } from '@zhin.js/core/runtime';
import { describeCommandDenial, PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot, type SnapshotLease } from '@zhin.js/plugin-runtime';
import {
  createRuntimeManagementCommands,
  type RuntimeManagementCommandHost,
  type RuntimeManagementOperation,
} from '../../src/init/runtime-management-commands.js';

/**
 * zhinjs/zhin#1250 第 83 批: the Agent management commands are Root commands. These tests run them
 * through the real command dispatch (CommandIndex + MessageDispatcher + inbound spine): routing,
 * permits, argument parsing, menu visibility, outcomes and their priority over the AI route.
 */
type Role = 'owner' | 'admin' | 'trusted';

function harness(options: {
  host?: Partial<RuntimeManagementCommandHost>;
  operation?: Partial<RuntimeManagementOperation>;
  prefix?: string;
} = {}) {
  const root = rootPluginId();
  const archiveSession = vi.fn(async () => true);
  const compactSession = vi.fn(async () => ({ ok: true, message: 'compacted' }));
  const list = vi.fn(async () => [{ label: 'openai/gpt-4o', reference: { id: 'p1' }, model: 'gpt-4o' }]);
  const replyFixed = vi.fn(async () => undefined);
  const withModelScope = vi.fn(<T>(run: () => Promise<T>) => run());
  const opened: Message[] = [];
  const operation: RuntimeManagementOperation = {
    sessionKey: 'session-1', inference: { list } as never, withModelScope, replyFixed, ...options.operation,
  };
  const commands = createRuntimeManagementCommands({
    zhinAgent: { archiveSession, compactSession } as never,
    open: async (message, _signal, run) => { opened.push(message); return run(operation); },
    ...options.host,
  });
  const slots = commands.map(command => createCapabilitySlot({
    owner: root, feature: commandFeatureId, localName: command.name, source: `/agent/${command.name}`, definition: command.definition,
  }));
  const snapshot = {
    generation: 1, root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), resources: new Map([[root, new Map([[permissionHostToken.id, new PermissionHost()]])]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  } as unknown as RuntimeSnapshot;
  (snapshot.projections as Map<string, unknown>).set(commandFeatureId, new CommandIndex(slots, snapshot, {}));
  const prefix = options.prefix ?? '/';
  const dispatcher = new MessageDispatcher(() => prefix);

  async function send(content: string, at: { kind?: 'private' | 'group' | 'channel'; role?: Role; locale?: 'zh-CN' | 'en' } = {}) {
    const kind = at.kind ?? 'group';
    const outcomes: Record<string, unknown>[] = [];
    const sink = { report: (candidate: Record<string, unknown>) => { outcomes.push(candidate); return true; }, enter() {} };
    const message = {
      id: 'm1',
      conversation: { endpoint: { id: 'ep-1', adapter: 'qq' }, kind, id: kind === 'private' ? 'u1' : 'g1' },
      content, locale: at.locale ?? 'zh-CN', endpointId: 'bot', commandPrefix: prefix,
      sender: { id: 'u1', ...(at.role ? { chatRole: at.role } : {}) },
      $reply: vi.fn(async () => ({ status: 'sent' })),
      [inboundOutcomeSink]: () => sink,
    } as unknown as Message;
    const route = vi.fn(async () => true);
    const outcome = await executeInboundTurnSpine({
      message,
      lease: { value: snapshot, stopSignal: new AbortController().signal } as unknown as SnapshotLease,
      requester: root,
      conversationSequence: 1,
      ingressRoute: { route },
      runHandlers: async () => undefined,
      dispatchInteractive: async () => undefined,
      dispatchCommand: observe => dispatcher.dispatchWithReply(message, snapshot, undefined, observe),
      hasReplied: () => false,
    });
    return { outcome, outcomes, route, reply: outcome.reply?.content, message };
  }

  return { send, commands, archiveSession, compactSession, list, replyFixed, withModelScope, opened, snapshot };
}

const denial = (locale: 'zh-CN' | 'en' = 'zh-CN') => describeCommandDenial('trusted', locale);

describe('Agent management Root commands (#1250 第 83 批)', () => {
  it('registers models, health, tree, fork, compact and reset; memory only with semantic memory', () => {
    expect(harness().commands.map(command => command.name)).toEqual(['models', 'health', 'tree', 'fork', 'compact', 'reset']);
    const withMemory = harness({ host: { semanticMemory: { active: true } as never } });
    expect(withMemory.commands.map(command => command.name)).toEqual(['models', 'health', 'tree', 'fork', 'compact', 'reset', 'memory', 'memory/forget']);
    for (const command of withMemory.commands) {
      expect(command.definition.description).toBeTruthy();
      expect(command.definition.descriptionI18n?.en).toBeTruthy();
      // No cooldown, like the ingress commands they replace.
      expect(command.definition.execution).toBeUndefined();
    }
    const permits = Object.fromEntries(withMemory.commands.map(command => [command.name, command.definition.permit]));
    expect(permits).toEqual({ models: ['trusted'], health: ['trusted'], tree: ['trusted'], fork: ['trusted'], compact: ['trusted'],
      reset: undefined, memory: undefined, 'memory/forget': undefined });
  });

  it('runs every command for owners, admins and trusted users, records command_replied and skips the AI route', async () => {
    for (const role of ['owner', 'admin', 'trusted'] as const) {
      const h = harness();
      const models = await h.send('/models', { role });
      expect(models.reply).toContain('openai/gpt-4o (gpt-4o)');
      expect(models.outcomes).toContainEqual(expect.objectContaining({ outcome: 'command_replied', reason: 'executed', command: 'models' }));
      expect(models.route).not.toHaveBeenCalled();
      expect(h.list).toHaveBeenCalledWith({ kind: 'language' });
      expect((await h.send('/health', { role })).reply).toContain('1 configured language profiles');
      expect((await h.send('/compact', { role })).reply).toBe('✅ compacted');
      expect(h.compactSession).toHaveBeenCalledWith('session-1', 'zh-CN');
      expect(h.withModelScope).toHaveBeenCalled();
      const reset = await h.send('/reset', { role });
      expect(h.archiveSession).toHaveBeenCalledWith('session-1');
      // The fixed confirmation goes out through the session's fixed-reply path (ADR 0067 D8).
      expect(h.replyFixed).toHaveBeenCalledWith('✅ 已归档当前会话，下次 @ 将使用新上下文');
      expect(reset.reply).toBeUndefined();
      expect(reset.outcomes).toContainEqual(expect.objectContaining({ outcome: 'command_replied', command: 'reset' }));
      expect(reset.route).not.toHaveBeenCalled();
    }
  });

  it('is silent to a sender without a chat role in a group or channel and runs nothing', async () => {
    for (const kind of ['group', 'channel'] as const) {
      for (const content of ['/models', '/health', '/tree', '/tree 1', '/fork 1', '/compact', '/reset']) {
        const h = harness();
        const sent = await h.send(content, { kind });
        expect(sent.reply).toBeUndefined();
        expect(sent.route).not.toHaveBeenCalled();
        expect(h.opened).toEqual([]);
        expect(h.archiveSession).not.toHaveBeenCalled();
        expect(h.replyFixed).not.toHaveBeenCalled();
        expect(sent.outcomes).toContainEqual(expect.objectContaining({ outcome: 'permission_denied', reply: 'no' }));
      }
    }
  });

  it('tells a sender without a chat role why in a private chat; reset points at the clear command', async () => {
    const h = harness();
    const models = await h.send('/models', { kind: 'private' });
    expect(models.reply).toBe(denial());
    expect(models.outcomes).toContainEqual(expect.objectContaining({ outcome: 'permission_denied', reason: 'denied:trusted' }));
    expect((await h.send('/fork 1', { kind: 'private', locale: 'en' })).reply).toBe(denial('en'));
    const reset = await h.send('/reset', { kind: 'private' });
    expect(reset.reply).toBe(`${denial()}要清空你自己的 AI 对话上下文，请发 /clear 或「清空」（群里先 @ 机器人）。`);
    expect(reset.outcomes).toContainEqual({ outcome: 'permission_denied', reason: 'not_operator', stage: 'command', command: 'reset', reply: 'yes' });
    expect((await h.send('/reset', { kind: 'private', locale: 'en' })).reply)
      .toBe(`${denial('en')} To clear your own AI conversation context, send /clear or 清空 (mention the bot first in a group).`);
    expect(h.archiveSession).not.toHaveBeenCalled();
    expect(reset.route).not.toHaveBeenCalled();
  });

  it('parses tree / fork arguments and answers mistakes of a permitted sender with the usage', async () => {
    const h = harness();
    const jump = vi.fn(async () => ({ ok: true, preview: '原文', code: 'switched' }));
    const zhinAgent = {
      archiveSession: h.archiveSession, compactSession: h.compactSession,
      agentSessionStore: { getOrCreateActive: async () => ({ session_id: 's' }) },
      contextRepository: { listBranchPoints: async () => [{ index: 1, preview: '原文' }], jumpToBranchIndex: jump },
    };
    const t = harness({ host: { zhinAgent: zhinAgent as never } });
    const list = await t.send('/tree', { role: 'trusted', locale: 'en' });
    expect(list.reply).toContain('jump with /tree N; continue from a point with /fork N');
    expect(list.reply).toContain('1. 原文');
    expect((await t.send('/tree 1', { role: 'trusted' })).reply).toBe('✅ 已跳转到分支点 #1：原文');
    expect((await t.send('/fork 1', { role: 'trusted' })).reply).toBe('✅ 已跳转到分支点 #1：原文');
    expect(jump).toHaveBeenCalledWith('s', 1);
    for (const content of ['/tree 0', '/tree x', '/fork', '/fork 0']) {
      const wrong = await t.send(content, { role: 'trusted' });
      expect(wrong.outcomes).toContainEqual(expect.objectContaining({ outcome: 'invalid_input' }));
      expect(String(wrong.reply)).toMatch(content.startsWith('/tree') ? /\/tree/u : /\/fork/u);
      expect(wrong.route).not.toHaveBeenCalled();
    }
    expect(jump).toHaveBeenCalledTimes(2);
  });

  it('uses the actual prefix in replies and leaves other text to the AI route', async () => {
    const t = harness({ prefix: '!' });
    expect((await t.send('!models', { role: 'owner', locale: 'en' })).reply).toContain('Available models');
    const unprefixed = await t.send('/models', { role: 'owner' });
    expect(unprefixed.route).toHaveBeenCalled();
    const chat = await t.send('hello', { role: 'owner' });
    expect(chat.route).toHaveBeenCalled();
    expect(t.list).toHaveBeenCalledTimes(1);
  });

  it('lists the commands in the menu only for senders who may run them', async () => {
    const h = harness({ host: { semanticMemory: { active: true } as never } });
    const index = h.snapshot.projections.get(commandFeatureId) as CommandIndex;
    const menu = async (role?: Role) => JSON.stringify((await index.dispatch({ input: 'help', commandPrefix: '/', snapshot: h.snapshot, source: {
      conversation: { endpoint: { id: 'ep-1', adapter: 'qq' }, kind: 'group', id: 'g1' }, content: '/help',
      sender: { id: 'u1', ...(role ? { chatRole: role } : {}) },
    } })));
    const operator = await menu('trusted');
    for (const name of ['models', 'health', 'tree', 'fork', 'compact', 'reset', 'memory']) expect(operator).toContain(name);
    const member = await menu();
    for (const name of ['models', 'health', 'tree', 'fork', 'compact']) expect(member).not.toContain(`/${name}`);
    expect(member).toContain('memory');
  });
});

describe('memory / memory forget', () => {
  function memory(entries: { id: string; key: string; content: string }[], active = true) {
    const store = [...entries];
    return {
      active,
      list: vi.fn(async (query: { scope_key: string; limit: number }) => query.scope_key === 'u1' ? store.slice(0, query.limit) : []),
      delete: vi.fn(async (id: string) => { store.splice(store.findIndex(entry => entry.id === id), 1); }),
    };
  }

  it('lists and forgets only the sender\'s own memory, for everyone', async () => {
    const runtime = memory([{ id: 'a1', key: 'pet', content: '橘猫团子' }, { id: 'a2', key: 'tea', content: '乌龙' }]);
    const h = harness({ host: { semanticMemory: runtime as never } });
    const listed = await h.send('/memory');
    expect(listed.reply).toContain('关于你的记忆（2 条）');
    expect(listed.reply).toContain('橘猫团子');
    expect(listed.reply).toContain('发送 /memory forget <key 或 id> 遗忘一条');
    expect(runtime.list).toHaveBeenCalledWith({ scope: 'user', scope_key: 'u1', limit: 20 }, expect.any(AbortSignal));
    expect(listed.route).not.toHaveBeenCalled();
    expect((await h.send('/memory forget')).reply).toBe('ℹ️ 用法：/memory forget <key 或 id>，或 /memory forget all');
    expect((await h.send('/memory forget pet')).reply).toContain('已遗忘 1 条');
    expect(runtime.delete).toHaveBeenCalledWith('a1', expect.any(AbortSignal));
    expect((await h.send('/memory forget nothing')).reply).toContain('没有找到');
    expect((await h.send('/memory forget all')).reply).toContain('已遗忘 1 条');
    expect((await h.send('/memory', { kind: 'private', locale: 'en' })).reply).toBe('ℹ️ There are no memories about you.');
  });

  it('says long-term memory is off instead of handing the command to the AI', async () => {
    const h = harness({ host: { semanticMemory: memory([], false) as never } });
    const sent = await h.send('/memory');
    expect(sent.reply).toBe('ℹ️ 未启用长期记忆。');
    expect(sent.route).not.toHaveBeenCalled();
  });
});
