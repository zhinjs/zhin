/**
 * ToolFeature 补全测试
 * 测试 toolToCommand / commandToTool / ToolFeature.add / filterByContext
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generatePattern,
  extractParamInfo,
  toolToCommand,
  commandToTool,
  canAccessTool,
  inferPermissionLevel,
  hasPermissionLevel,
  ZhinTool,
  isZhinTool,
  ToolFeature,
} from '../src/built/tool.js';
import type { Tool, ToolContext } from '../src/types.js';

describe('generatePattern', () => {
  it('应生成无参数的模式', () => {
    const tool: Tool = {
      name: 'ping',
      description: '测试',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'pong',
    };
    expect(generatePattern(tool)).toBe('ping');
  });

  it('应生成有必填参数的模式', () => {
    const tool: Tool = {
      name: 'weather',
      description: '天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市' } },
        required: ['city'],
      },
      execute: async () => '',
    };
    expect(generatePattern(tool)).toBe('weather <city:text>');
  });

  it('应生成有可选参数的模式', () => {
    const tool: Tool = {
      name: 'search',
      description: '搜索',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
      execute: async () => '',
    };
    const pattern = generatePattern(tool);
    expect(pattern).toContain('<query:text>');
    expect(pattern).toContain('[limit:number]');
  });

  it('应使用自定义 command.pattern', () => {
    const tool: Tool = {
      name: 'custom',
      description: '自定义',
      parameters: { type: 'object', properties: {} },
      execute: async () => '',
      command: { pattern: 'my-custom <arg:text>', enabled: true },
    };
    expect(generatePattern(tool)).toBe('my-custom <arg:text>');
  });
});

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

  const baseContext: ToolContext = {
    platform: 'qq',
    botId: 'bot1',
    sceneId: 'scene1',
    senderId: 'user1',
  };

  it('无限制的工具应始终可访问', () => {
    expect(canAccessTool(baseTool, baseContext)).toBe(true);
  });

  it('应检查平台限制', () => {
    const tool = { ...baseTool, platforms: ['discord'] };
    expect(canAccessTool(tool, { ...baseContext, platform: 'qq' })).toBe(false);
    expect(canAccessTool(tool, { ...baseContext, platform: 'discord' })).toBe(true);
  });

  it('应检查场景限制', () => {
    const tool = { ...baseTool, scopes: ['group' as const] };
    expect(canAccessTool(tool, { ...baseContext, scope: 'private' })).toBe(false);
    expect(canAccessTool(tool, { ...baseContext, scope: 'group' })).toBe(true);
  });

  it('应检查权限级别', () => {
    const tool = { ...baseTool, permissionLevel: 'group_admin' as const };
    expect(canAccessTool(tool, { ...baseContext })).toBe(false); // user level
    expect(canAccessTool(tool, { ...baseContext, isGroupAdmin: true })).toBe(true);
  });
});

describe('inferPermissionLevel', () => {
  it('应使用 senderPermissionLevel 优先', () => {
    expect(inferPermissionLevel({ senderPermissionLevel: 'owner' } as any)).toBe('owner');
  });

  it('应按优先级推断', () => {
    expect(inferPermissionLevel({ isOwner: true } as any)).toBe('owner');
    expect(inferPermissionLevel({ isBotAdmin: true } as any)).toBe('bot_admin');
    expect(inferPermissionLevel({ isGroupOwner: true } as any)).toBe('group_owner');
    expect(inferPermissionLevel({ isGroupAdmin: true } as any)).toBe('group_admin');
    expect(inferPermissionLevel({} as any)).toBe('user');
  });
});

describe('hasPermissionLevel', () => {
  it('相同级别应返回 true', () => {
    expect(hasPermissionLevel('user', 'user')).toBe(true);
    expect(hasPermissionLevel('owner', 'owner')).toBe(true);
  });

  it('高级别应能访问低级别', () => {
    expect(hasPermissionLevel('owner', 'user')).toBe(true);
    expect(hasPermissionLevel('bot_admin', 'group_admin')).toBe(true);
  });

  it('低级别不能访问高级别', () => {
    expect(hasPermissionLevel('user', 'group_admin')).toBe(false);
    expect(hasPermissionLevel('group_admin', 'owner')).toBe(false);
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
  });

  describe('filterByContext', () => {
    it('应过滤不符合权限的工具', () => {
      const tools: Tool[] = [
        { name: 'public', description: '公开', parameters: { type: 'object', properties: {} }, execute: async () => '' },
        { name: 'admin', description: '管理', parameters: { type: 'object', properties: {} }, execute: async () => '', permissionLevel: 'bot_admin' },
      ];
      const context: ToolContext = { platform: 'qq', botId: 'b', sceneId: 's', senderId: 'u' };
      const filtered = feature.filterByContext(tools, context);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('public');
    });

    it('应过滤不符合平台的工具', () => {
      const tools: Tool[] = [
        { name: 'all', description: '', parameters: { type: 'object', properties: {} }, execute: async () => '' },
        { name: 'discord-only', description: '', parameters: { type: 'object', properties: {} }, execute: async () => '', platforms: ['discord'] },
      ];
      const context: ToolContext = { platform: 'qq', botId: 'b', sceneId: 's', senderId: 'u' };
      const filtered = feature.filterByContext(tools, context);
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
      .permission('bot_admin')
      .execute(async () => '');

    const json = zt.toJSON();
    expect(json.name).toBe('test');
    expect(json.description).toBe('描述');
    expect(json.tags).toEqual(['t1']);
    expect(json.platforms).toEqual(['qq']);
    expect(json.permissionLevel).toBe('bot_admin');
  });
});
