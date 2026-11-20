import { describe, it, expect, vi } from 'vitest';
import { describeCommandDenial } from '@zhin.js/permission';
import { handleRuntimeManagementCommand } from '../../src/init/runtime-management-commands.js';

describe('handleRuntimeManagementCommand', () => {
  const senderRoles = { hostRole: 'owner' } as const;

  it('returns null for unrelated content', async () => {
    const reply = await handleRuntimeManagementCommand({
      service: {} as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: 'hello',
      senderRoles,
    });
    expect(reply).toBeNull();
  });

  it('denies non-operators for /models', async () => {
    const onUnauthorized = vi.fn();
    const reply = await handleRuntimeManagementCommand({
      service: { listModels: vi.fn() } as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: '/models',
      senderRoles: {},
      onUnauthorized,
    });
    expect(reply).toBe(describeCommandDenial('trusted', 'zh-CN'));
    // #1250: the refusal is flagged so the ingress can stay silent in a group.
    expect(onUnauthorized).toHaveBeenCalledWith('not_operator');
  });

  it('flags every operator-only refusal and nothing an operator sends (#1250)', async () => {
    const denial = describeCommandDenial('trusted', 'zh-CN');
    const resetDenial = `${denial}要清空你自己的 AI 对话上下文，请发 /clear 或「清空」（群里先 @ 机器人）。`;
    for (const content of ['/models', '/tree', '/tree 2', '/fork 2', '/compact', '/reset', 'ai.health']) {
      const onUnauthorized = vi.fn();
      const archiveSession = vi.fn();
      const compactSession = vi.fn();
      expect(await handleRuntimeManagementCommand({
        service: {} as never, zhinAgent: { archiveSession, compactSession } as never, sessionKey: 'test:session',
        commandPrefix: '/', content, senderRoles: {}, onUnauthorized,
      })).toBe(content === '/reset' ? resetDenial : denial);
      expect(onUnauthorized).toHaveBeenCalledWith('not_operator');
      expect(archiveSession).not.toHaveBeenCalled();
      expect(compactSession).not.toHaveBeenCalled();
    }
    const onUnauthorized = vi.fn();
    expect(await handleRuntimeManagementCommand({
      service: {} as never, zhinAgent: {} as never, sessionKey: 'test:session', commandPrefix: '/', content: '/tree x',
      senderRoles, onUnauthorized,
    })).toBeNull();
    expect(await handleRuntimeManagementCommand({
      service: {} as never, zhinAgent: { archiveSession: vi.fn().mockResolvedValue(false) } as never, sessionKey: 'test:session',
      commandPrefix: '/', content: '/reset', senderRoles, onUnauthorized,
    })).toContain('无活跃会话');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps reset operator-only and points everyone else at /clear (#1250)', async () => {
    const archiveSession = vi.fn();
    const reply = await handleRuntimeManagementCommand({
      service: {} as never,
      zhinAgent: { archiveSession } as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: '/reset',
      senderRoles: {},
    });
    expect(reply).toBe('没有权限执行此指令。此功能需要 zhin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。要清空你自己的 AI 对话上下文，请发 /clear 或「清空」（群里先 @ 机器人）。');
    expect(await handleRuntimeManagementCommand({
      service: {} as never, zhinAgent: { archiveSession } as never, sessionKey: 'test:session',
      commandPrefix: '/', content: '/reset', senderRoles: {}, locale: 'en',
    })).toBe(`${describeCommandDenial('trusted', 'en')} To clear your own AI conversation context, send /clear or 清空 (mention the bot first in a group).`);
    expect(archiveSession).not.toHaveBeenCalled();
    const archive = vi.fn().mockResolvedValue(true);
    const operator = await handleRuntimeManagementCommand({
      service: {} as never, zhinAgent: { archiveSession: archive } as never, sessionKey: 'test:session',
      commandPrefix: '/', content: '/reset', senderRoles: { hostRole: 'trusted' }, locale: 'en',
    });
    expect(archive).toHaveBeenCalledWith('test:session');
    expect(operator).toContain('archived');
  });

  it('lists models for operators', async () => {
    const list = vi.fn().mockResolvedValue(['gpt-4o', 'o1', 'o3', 'a', 'b', 'c'].map(model => ({ label: `openai/${model}`, model })));
    const reply = await handleRuntimeManagementCommand({
      service: {} as never, inference: { list } as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: '/models',
      senderRoles,
    });
    expect(list).toHaveBeenCalledWith({ kind: 'language' });
    expect(reply).toContain('openai');
    expect(reply).toContain('gpt-4o');
    expect(reply).toContain('openai/c');
  });

  it('formats ai.health', async () => {
    const list = vi.fn().mockResolvedValue([{ label: 'openai', model: 'selected' }]);
    const reply = await handleRuntimeManagementCommand({
      service: {} as never, inference: { list } as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: 'ai.health',
      senderRoles: { hostRole: 'trusted' },
    });
    expect(reply).toContain('1 configured language profiles');
    expect(list).toHaveBeenCalledWith({ kind: 'language' });
  });
});

it.each(['!', '', '/'])('uses the actual %j prefix and keeps plugin namespaces distinct', async commandPrefix => {
  const list = vi.fn().mockResolvedValue([{ label: 'custom', model: '中文模型名' }]);
  const base = { service: {} as never, inference: { list } as never, zhinAgent: {} as never, sessionKey: 's',
    senderRoles: { hostRole: 'owner' as const }, commandPrefix, locale: 'en' as const };
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models` })).toContain('Available models');
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models` })).toContain('中文模型名');
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}plugin/models` })).toBeNull();
  expect(await handleRuntimeManagementCommand({ ...base, commandPrefix: undefined, content: '/models' })).toBeNull();
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models`, senderRoles: {} })).toBe(describeCommandDenial('trusted', 'en'));
});

it('uses immutable per-invocation presentation for concurrent locales', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const base = { service: {} as never, inference: { list: async () => { await ready; return []; } } as never,
    zhinAgent: {} as never, sessionKey: 's', content: '!models', commandPrefix: '!',
    senderRoles: { hostRole: 'owner' } };
  const en = handleRuntimeManagementCommand({ ...base, locale: 'en' });
  const zh = handleRuntimeManagementCommand({ ...base, locale: 'zh-CN' });
  release();
  await expect(en).resolves.toContain('Available models');
  await expect(zh).resolves.toContain('可用模型');
});
