import { describe, it, expect } from 'vitest';
import { validateAiRoutingConfig } from '../../src/config/validate-ai-config.js';
import { normalizeAiRoutingConfig } from '../../src/config/normalize-ai-config.js';

describe('validateAiRoutingConfig', () => {
  it('rejects removed ai.workrooms instead of silently requiring a restart', () => {
    expect(() => normalizeAiRoutingConfig({
      workrooms: { legacy: {} },
    } as never)).toThrow('ai.workrooms removed; manage the persistent Workroom Catalog');
  });

  it.each([
    [{ remoteAgents: [] }, 'ai.remoteAgents removed'],
    [{ remote_mesh: null }, 'ai.remote_mesh removed'],
    [{ remoteMesh: {} }, 'ai.remote_mesh removed'],
  ] as const)('rejects removed remote execution config %j', (legacy, message) => {
    expect(() => normalizeAiRoutingConfig(legacy as never)).toThrow(message);
  });

  it('priority/match 已弃用：仍可通过校验，并从生效配置中移除', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm', priority: 1, match: { hasMedia: ['image'] } },
        vision: { provider: 'p', model: 'm2', match: { hasMedia: ['image'] } },
        reviewer: { provider: 'p', model: 'm3', priority: 100, match: [{}] },
      },
    } as any);
    expect(validateAiRoutingConfig(cfg)).toEqual([]);
    for (const binding of Object.values(cfg.agents)) {
      expect(binding).not.toHaveProperty('priority');
      expect(binding).not.toHaveProperty('match');
    }
    expect(cfg.agents.vision).toEqual({ provider: 'p', model: 'm2' });
  });

  it('拒绝 binding 引用未声明的 MCP server', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm', mcpServers: ['missing'] },
      },
      mcpServers: [],
    } as any);
    expect(validateAiRoutingConfig(cfg)).toContain(
      'ai.agents.zhin: unknown MCP server "missing"',
    );
  });

  it('providers 缺少 sdk 时报错', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'm' } },
    } as any);
    cfg.providers.p = { apiKey: 'k' } as typeof cfg.providers.p;
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('sdk is required'))).toBe(true);
  });

  it('legacy driver 字段硬报错（一次性升级走 zhin setup）', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { deepseek: { driver: 'deepseek', apiKey: 'k' } },
      agents: { zhin: { provider: 'deepseek', model: 'm' } },
    } as any)).toThrow(/"driver" is removed; use "sdk" instead/);
  });

  it('旧平铺 providers 写法硬报错（缺少显式 sdk）', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { openai: { apiKey: 'k' } },
      agents: { zhin: { provider: 'openai', model: 'm' } },
    } as any)).toThrow(/sdk is required.*命名 providers/s);
  });

  it('拒绝 ai.routes', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'base' } },
      routes: { vision: { priority: 10, match: { adapter: 'icqq' } } },
    } as any)).toThrow(/ai\.routes removed/);
  });

  it('拒绝 ai.pipeline', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'base' } },
      pipeline: { evaluator: { provider: 'p', model: 'glm', nickname: '分析师' } },
    } as any)).toThrow(/ai\.pipeline removed/);
  });

  it('拒绝 api/preset/spec 字段', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { p: { api: 'openai-completions', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'm' } },
    } as any)).toThrow(/use "sdk" instead/);
  });
});
