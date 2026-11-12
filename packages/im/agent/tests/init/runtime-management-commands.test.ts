import { describe, it, expect, vi } from 'vitest';
import { handleRuntimeManagementCommand } from '../../src/init/runtime-management-commands.js';

describe('handleRuntimeManagementCommand', () => {
  const senderRoles = { isMaster: true, isTrusted: false };

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
    const reply = await handleRuntimeManagementCommand({
      service: { listModels: vi.fn() } as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: '/models',
      senderRoles: { isMaster: false, isTrusted: false },
    });
    expect(reply).toContain('owner / admin / trusted');
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
      senderRoles: { isMaster: false, isTrusted: true },
    });
    expect(reply).toContain('1 configured language profiles');
    expect(list).toHaveBeenCalledWith({ kind: 'language' });
  });
});

it.each(['!', '', '/'])('uses the actual %j prefix and keeps plugin namespaces distinct', async commandPrefix => {
  const list = vi.fn().mockResolvedValue([{ label: 'custom', model: '中文模型名' }]);
  const base = { service: {} as never, inference: { list } as never, zhinAgent: {} as never, sessionKey: 's',
    senderRoles: { isMaster: true, isTrusted: false }, commandPrefix, locale: 'en' as const };
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models` })).toContain('Available models');
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models` })).toContain('中文模型名');
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}plugin/models` })).toBeNull();
  expect(await handleRuntimeManagementCommand({ ...base, commandPrefix: undefined, content: '/models' })).toBeNull();
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models`, senderRoles: { isMaster: false, isTrusted: false } })).toContain('Only chat roles owner / admin / trusted');
});

it('uses immutable per-invocation presentation for concurrent locales', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const base = { service: {} as never, inference: { list: async () => { await ready; return []; } } as never,
    zhinAgent: {} as never, sessionKey: 's', content: '!models', commandPrefix: '!',
    senderRoles: { isMaster: true, isTrusted: false } };
  const en = handleRuntimeManagementCommand({ ...base, locale: 'en' });
  const zh = handleRuntimeManagementCommand({ ...base, locale: 'zh-CN' });
  release();
  await expect(en).resolves.toContain('Available models');
  await expect(zh).resolves.toContain('可用模型');
});
