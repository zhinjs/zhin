import { describe, it, expect, vi } from 'vitest';
import { handleRuntimeManagementCommand } from '../../src/init/runtime-management-commands.js';

describe('handleRuntimeManagementCommand', () => {
  const senderRoles = { isMaster: true, isTrusted: false };

  it('returns null for unrelated content', async () => {
    const reply = await handleRuntimeManagementCommand({
      service: {} as never,
      zhinAgent: {} as never,
      sessionKey: 'test:session',
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
      content: 'ai.health',
      senderRoles: { isMaster: false, isTrusted: true },
    });
    expect(reply).toContain('✅ openai');
    expect(reply).toContain('❌ local');
  });
});
