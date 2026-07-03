/**
 * ToolFeature 测试
 * 测试 ToolFeature.add / filterByContext / ZhinTool / canAccessTool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractParamInfo,
  canAccessTool,
  ZhinTool,
  isZhinTool,
  ToolFeature,
} from '../src/built/tool.js';
import {
  registerDefaultScenePlatformPermitChecker,
  clearPlatformPermitCheckers,
} from '../src/built/platform-permit.js';
import type { Tool } from '../src/types.js';

beforeEach(() => {
  registerDefaultScenePlatformPermitChecker('qq');
});

afterEach(() => {
  clearPlatformPermitCheckers();
});

function mockCommMessage(overrides: Record<string, any> = {}) {
  const scope = overrides.scope ?? 'private';
  return {
    $adapter: overrides.adapter ?? 'qq',
    $endpoint: overrides.endpoint ?? 'bot1',
    $sender: {
      id: overrides.senderId ?? 'user1',
      ...(overrides.sender ?? {}),
      ...(overrides.role !== undefined ? { role: overrides.role } : {}),
    },
    $channel: { type: scope, id: overrides.sceneId ?? 'scene1' },
  };
}



describe('extractParamInfo', () => {
  it('应从空 properties 返回空数组', () => {
    expect(extractParamInfo({ type: 'object', properties: {} })).toEqual([]);
  });

  it('应提取参数信息', () => {
    const result = extractParamInfo({
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
        days: { type: 'number', description: '天数' },
      },
      required: ['city'],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'city', type: 'string', required: true, description: '城市名' });
    expect(result[1]).toMatchObject({ name: 'days', type: 'number', required: false, description: '天数' });
  });
});

describe('canAccessTool', () => {
  const baseTool: Tool = {
    name: 'test',
    description: '测试',
    parameters: { type: 'object', properties: {} },
    execute: async () => '',
  };


  it('无限制的工具应始终可访问', () => {
    expect(canAccessTool(baseTool, mockCommMessage({ adapter: 'qq', endpoint: 'bot1', senderId: 'user1', sceneId: 'scene1' }))).toBe(true);
  });

  it('应检查平台限制', () => {
    const tool = { ...baseTool, platforms: ['discord'] };
    expect(canAccessTool(tool, mockCommMessage({ adapter: 'qq', endpoint: 'bot1', senderId: 'user1', sceneId: 'scene1' }))).toBe(false);
    expect(canAccessTool(tool, mockCommMessage({ adapter: 'discord', endpoint: 'bot1', senderId: 'user1', sceneId: 'scene1' }))).toBe(true);
  });

  it('应检查场景限制', () => {
    const tool = { ...baseTool, scopes: ['group' as const] };
    expect(canAccessTool(tool, mockCommMessage({ adapter: 'qq', scope: 'private', endpoint: 'bot1', senderId: 'user1', sceneId: 'scene1' }))).toBe(false);
    expect(canAccessTool(tool, mockCommMessage({ adapter: 'qq', scope: 'group', endpoint: 'bot1', senderId: 'user1', sceneId: 'scene1' }))).toBe(true);
  });

  it('应检查 platform(...) permit', () => {
    const tool = { ...baseTool, permissions: ['platform(qq,scene_admin)'] };
    const msg = {
      $adapter: 'qq',
      $endpoint: 'b1',
      $sender: { id: 'u1', role: 'admin' },
      $channel: { type: 'group', id: 'g1' },
    } as any;
    expect(canAccessTool(tool, mockCommMessage({ adapter: 'qq', endpoint: 'bot1', senderId: 'user1', sceneId: 'scene1' }))).toBe(false);
    expect(canAccessTool(tool, msg)).toBe(true);
  });
});

describe('ToolFeature', () => {
  let feature: ToolFeature;

  beforeEach(() => {
    feature = new ToolFeature();
  });

  describe('基础操作', () => {
    it('初始状态应无工具', () => {
      expect(feature.items).toHaveLength(0);
      expect(feature.byName.size).toBe(0);
    });

    it('toJSON 应返回正确结构', () => {
      const json = feature.toJSON();
      expect(json).toMatchObject({
        name: 'tool',
        icon: 'Wrench',
        desc: '工具',
        count: 0,
        items: [],
      });
    });

    it('同名工具重复注册不应在 items 中留下重复项', () => {
      const def = {
        name: 'github_star',
        description: 'star',
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'v1',
      };
      const dispose1 = feature.addTool(def, 'adapter-github');
      expect(feature.getAll()).toHaveLength(1);
      const dispose2 = feature.addTool(
        { ...def, description: 'star v2', execute: async () => 'v2' },
        'adapter-github',
      );
      expect(feature.getAll()).toHaveLength(1);
      expect(feature.get('github_star')?.description).toBe('star v2');
      dispose2();
      dispose1();
    });
  });

  describe('filterByContext', () => {
    it('应过滤不符合权限的工具', () => {
      const tools: Tool[] = [
        { name: 'public', description: '公开', parameters: { type: 'object', properties: {} }, execute: async () => '' },
        { name: 'admin', description: '管理', parameters: { type: 'object', properties: {} }, execute: async () => '', permissions: ['role(trusted)'] },
      ];
      const filtered = feature.filterByContext(tools, mockCommMessage({ adapter: 'qq', endpoint: 'b', senderId: 'u', sceneId: 's' }) as any);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('public');
    });

    it('应过滤不符合平台的工具', () => {
      const tools: Tool[] = [
        { name: 'all', description: '', parameters: { type: 'object', properties: {} }, execute: async () => '' },
        { name: 'discord-only', description: '', parameters: { type: 'object', properties: {} }, execute: async () => '', platforms: ['discord'] },
      ];
      const filtered = feature.filterByContext(tools, mockCommMessage({ adapter: 'qq', endpoint: 'b', senderId: 'u', sceneId: 's' }) as any);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('all');
    });
  });
});

describe('ZhinTool', () => {
  it('应构建完整的 Tool 对象', () => {
    const zt = new ZhinTool('test')
      .desc('测试工具')
      .param('city', { type: 'string', description: '城市' }, true)
      .execute(async ({ city }) => `${city}: 晴`);

    const tool = zt.toTool();
    expect(tool.name).toBe('test');
    expect(tool.description).toBe('测试工具');
    expect(tool.parameters.properties).toHaveProperty('city');
    expect(tool.parameters.required).toEqual(['city']);
    expect(typeof tool.execute).toBe('function');
  });

  it('无 execute 应抛错', () => {
    const zt = new ZhinTool('no-exec').desc('无执行');
    expect(() => zt.toTool()).toThrow('has no execute()');
  });

  it('isZhinTool 应正确判断', () => {
    expect(isZhinTool(new ZhinTool('x'))).toBe(true);
    expect(isZhinTool({})).toBe(false);
    expect(isZhinTool(null)).toBe(false);
  });

  it('toJSON 应返回序列化数据', () => {
    const zt = new ZhinTool('test')
      .desc('描述')
      .param('a', { type: 'string' }, true)
      .tag('t1')
      .platform('qq')
      .permit('role(trusted)')
      .execute(async () => '');

    const json = zt.toJSON();
    expect(json.name).toBe('test');
    expect(json.description).toBe('描述');
    expect(json.tags).toEqual(['t1']);
    expect(json.platforms).toEqual(['qq']);
    expect(json.permissions).toEqual(['role(trusted)']);
  });
});
