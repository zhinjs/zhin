import { describe, it, expect } from 'vitest';
import { validateAiRoutingConfig, validateWorkroomDefinitions } from '../../src/config/validate-ai-config.js';
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

  it('校验 Workroom 的 Agent 成员、角色与协作空间关联', () => {
    const workrooms = {
        support: {
          name: '客户支持',
          members: [
            { agent: 'zhin', role: 'orchestrator' },
            { agent: 'reviewer', role: 'reviewer' },
          ],
          conversation: { adapter: 'telegram', endpoint: 'support-bot', kind: 'group', id: '10001', agent: 'zhin' },
        },
    };
    expect(validateWorkroomDefinitions(workrooms, ['zhin', 'reviewer'])).toEqual([]);

    workrooms.support.conversation.agent = 'missing';
    expect(validateWorkroomDefinitions(workrooms, ['zhin', 'reviewer'])).toContain(
      'workroomCatalog.support.conversation.agent: Agent must be a Workroom member',
    );
  });

  it('允许同一 Bot Endpoint 服务多个群，但拒绝重复绑定同一个完整会话地址', () => {
    const definition = (id: string) => ({
      name: 'Room',
      members: [{ agent: 'zhin', role: 'orchestrator' }],
      conversation: { adapter: 'telegram', endpoint: 'shared', kind: 'group', id, agent: 'zhin' },
    });
    const workrooms = { alpha: definition('group-a'), beta: definition('group-b') };
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toEqual([]);
    workrooms.beta.conversation.id = 'group-a';
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toContain(
      'workroomCatalog.beta.conversation: conversation "telegram:shared:group:group-a" is already owned by enabled Workroom "alpha"',
    );
  });

  it('接受 GitHub 仓库作为 Workroom 协作空间', () => {
    const workrooms = {
        zhin: {
          name: 'Zhin repo',
          members: [{ agent: 'zhin', role: 'orchestrator' }],
          conversation: { adapter: 'github', endpoint: 'app', kind: 'repository', id: 'zhinjs/zhin', agent: 'zhin' },
        },
    };
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toEqual([]);
  });

  it('拒绝 agents.zhin 配置 priority/match', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm', priority: 1, match: { hasMedia: ['image'] } },
      },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('agents.zhin') && e.includes('priority'))).toBe(true);
  });

  it('有 match 时必须提供 priority', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm' },
        vision: { provider: 'p', model: 'm2', match: { hasMedia: ['image'] } },
      },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('vision') && e.includes('priority'))).toBe(true);
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

  it('agents 内联 priority/match 可通过校验', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm' },
        vision: { provider: 'p', model: 'm2', priority: 10, match: { adapter: 'icqq' } },
      },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors).toEqual([]);
    expect(cfg.agents.vision?.priority).toBe(10);
    const visionMatch = cfg.agents.vision?.match;
    expect(visionMatch && !Array.isArray(visionMatch) && visionMatch.adapter).toBe('icqq');
  });

  it('拒绝无约束的 match 数组', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm' },
        reviewer: {
          provider: 'p',
          model: 'm2',
          priority: 100,
          match: [{}],
        },
      },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('reviewer') && e.includes('no routable constraints'))).toBe(true);
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
