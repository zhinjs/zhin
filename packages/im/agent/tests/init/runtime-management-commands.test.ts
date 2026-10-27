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
    expect(reply).toContain('master / trusted');
  });

  it('lists models for operators', async () => {
    const listModels = vi.fn().mockResolvedValue([
      { provider: 'openai', models: ['gpt-4o', 'o1', 'o3', 'a', 'b', 'c'] },
    ]);
    const reply = await handleRuntimeManagementCommand({
      service: { listModels } as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: '/models',
      senderRoles,
    });
    expect(listModels).toHaveBeenCalled();
    expect(reply).toContain('openai');
    expect(reply).toContain('gpt-4o');
    expect(reply).toContain('还有 1 个');
  });

  it('formats ai.health', async () => {
    const healthCheck = vi.fn().mockResolvedValue({ openai: true, local: false });
    const reply = await handleRuntimeManagementCommand({
      service: { healthCheck } as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
      commandPrefix: '/',
      content: 'ai.health',
      senderRoles: { isMaster: false, isTrusted: true },
    });
    expect(reply).toContain('✅ openai');
    expect(reply).toContain('❌ local');
  });
});

it.each(['!', '', '/'])('uses the actual %j prefix and keeps plugin namespaces distinct', async commandPrefix => {
  const listModels = vi.fn().mockResolvedValue([{ provider: 'custom', models: ['中文模型名'] }]);
  const base = { service: { listModels } as never, zhinAgent: {} as never, sessionKey: 's',
    senderRoles: { isMaster: true, isTrusted: false }, commandPrefix, locale: 'en' as const };
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models` })).toContain('Available models');
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models` })).toContain('中文模型名');
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}plugin/models` })).toBeNull();
  expect(await handleRuntimeManagementCommand({ ...base, commandPrefix: undefined, content: '/models' })).toBeNull();
  expect(await handleRuntimeManagementCommand({ ...base, content: `${commandPrefix}models`, senderRoles: { isMaster: false, isTrusted: false } })).toContain('Only master / trusted');
});

it('uses immutable per-invocation presentation for concurrent locales', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const base = { service: { listModels: async () => { await ready; return []; } } as never,
    zhinAgent: {} as never, sessionKey: 's', content: '!models', commandPrefix: '!',
    senderRoles: { isMaster: true, isTrusted: false } };
  const en = handleRuntimeManagementCommand({ ...base, locale: 'en' });
  const zh = handleRuntimeManagementCommand({ ...base, locale: 'zh-CN' });
  release();
  await expect(en).resolves.toContain('Available models');
  await expect(zh).resolves.toContain('可用模型');
});
