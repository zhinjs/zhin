/**
 * Tool Service 测试
 * 
 * 测试内容：
 * 1. ZhinTool 类的链式调用
 * 2. defineTool 辅助函数
 * 3. 工具参数构建
 * 4. 权限级别判断
 * 5. 命令模式生成
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  ZhinTool, 
  defineTool, 
  isZhinTool,
  generatePattern,
  extractParamInfo,
  hasPermissionLevel,
  inferPermissionLevel,
  canAccessTool,
  PERMISSION_LEVEL_PRIORITY,
} from '@zhin.js/core';
import type { Tool, ToolContext, ToolPermissionLevel } from '@zhin.js/core';

describe('ZhinTool 类', () => {
  it('应该能创建基本工具', () => {
    const tool = new ZhinTool('test_tool')
      .desc('测试工具')
      .execute(async () => '结果');

    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('测试工具');
  });

  it('应该支持链式调用添加参数', () => {
    const tool = new ZhinTool('weather')
      .desc('查询天气')
      .param('city', { type: 'string', description: '城市名' }, true)
      .param('days', { type: 'number', description: '天数' })
      .execute(async () => '晴天');

    const params = tool.params;
    expect(params).toHaveLength(2);
    expect(params[0].name).toBe('city');
    expect(params[0].required).toBe(true);
    expect(params[1].name).toBe('days');
    expect(params[1].required).toBe(false);
  });

  it('应该能设置平台和场景限制', () => {
    const tool = new ZhinTool('group_tool')
      .desc('群聊工具')
      .platform('qq', 'telegram')
      .scope('group')
      .execute(async () => '结果');

    const toolObj = tool.toTool();
    expect(toolObj.platforms).toEqual(['qq', 'telegram']);
    expect(toolObj.scopes).toEqual(['group']);
  });

  it('应该能设置权限级别', () => {
    const tool = new ZhinTool('admin_tool')
      .desc('管理员工具')
      .permission('bot_admin')
      .execute(async () => '结果');

    const toolObj = tool.toTool();
    expect(toolObj.permissionLevel).toBe('bot_admin');
  });

  it('应该能转换为 Tool 对象', () => {
    const tool = new ZhinTool('calculator')
      .desc('计算器')
      .param('expression', { type: 'string', description: '表达式' }, true)
      .execute(async (args) => `结果: ${args.expression}`);

    const toolObj = tool.toTool();
    
    expect(toolObj.name).toBe('calculator');
    expect(toolObj.description).toBe('计算器');
    expect(toolObj.parameters.properties).toHaveProperty('expression');
    expect(toolObj.parameters.required).toContain('expression');
    expect(typeof toolObj.execute).toBe('function');
  });

  it('没有 execute 时应该抛出错误', () => {
    const tool = new ZhinTool('no_execute')
      .desc('没有执行函数');

    expect(() => tool.toTool()).toThrow('has no execute()');
  });

  it('应该能生成帮助信息', () => {
    const tool = new ZhinTool('help_test')
      .desc('帮助测试')
      .param('name', { type: 'string', description: '名字' }, true)
      .permission('group_admin')
      .platform('qq')
      .scope('group')
      .execute(async () => '');

    const help = tool.help;
    
    expect(help).toContain('help_test');
    expect(help).toContain('帮助测试');
    expect(help).toContain('name');
    expect(help).toContain('group_admin');
    expect(help).toContain('qq');
    expect(help).toContain('group');
  });

  it('应该能设置命令配置', () => {
    const tool = new ZhinTool('cmd_test')
      .desc('命令测试')
      .usage('使用说明1', '使用说明2')
      .examples('/cmd_test arg1', '/cmd_test arg2')
      .alias('别名1', '别名2')
      .execute(async () => '');

    const toolObj = tool.toTool();
    
    // 没有设置 action，command 应该是 false
    expect(toolObj.command).toBe(false);
  });

  it('设置 action 后应该生成命令配置', () => {
    const tool = new ZhinTool('with_action')
      .desc('带命令的工具')
      .param('arg', { type: 'string' }, true)
      .usage('使用说明')
      .execute(async () => '')
      .action(async () => '命令结果');

    const toolObj = tool.toTool();
    
    expect(toolObj.command).not.toBe(false);
    expect((toolObj.command as any).enabled).toBe(true);
    expect((toolObj.command as any).usage).toContain('使用说明');
  });
});

describe('defineTool 辅助函数', () => {
  it('应该创建带类型的工具', () => {
    const tool = defineTool<{ city: string; days?: number }>({
      name: 'weather',
      description: '天气查询',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市' },
          days: { type: 'number', description: '天数' },
        },
        required: ['city'],
      },
      execute: async (args) => {
        // args.city 应该有类型提示
        return `${args.city} 的天气`;
      },
    });

    expect(tool.name).toBe('weather');
    expect(tool.parameters.required).toContain('city');
  });

  it('应该支持命令配置', () => {
    const tool = defineTool({
      name: 'calc',
      description: '计算器',
      parameters: { type: 'object', properties: {} },
      command: {
        pattern: 'calc <expr:rest>',
        alias: ['计算'],
      },
      execute: async () => '结果',
    });

    expect(tool.command).toBeTruthy();
    expect((tool.command as any).pattern).toBe('calc <expr:rest>');
  });
});

describe('isZhinTool 函数', () => {
  it('应该正确识别 ZhinTool 实例', () => {
    const zhinTool = new ZhinTool('test').execute(async () => '');
    const plainTool: Tool = {
      name: 'plain',
      description: '',
      parameters: { type: 'object', properties: {} },
      execute: async () => '',
    };

    expect(isZhinTool(zhinTool)).toBe(true);
    expect(isZhinTool(plainTool)).toBe(false);
    expect(isZhinTool(null)).toBe(false);
    expect(isZhinTool(undefined)).toBe(false);
  });
});

describe('generatePattern 函数', () => {
  it('应该生成基本命令模式', () => {
    const tool: Tool = {
      name: 'test',
      description: '',
      parameters: { type: 'object', properties: {} },
      execute: async () => '',
    };

    expect(generatePattern(tool)).toBe('test');
  });

  it('应该生成带参数的命令模式', () => {
    const tool: Tool = {
      name: 'weather',
      description: '',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市' },
          days: { type: 'number', description: '天数' },
        },
        required: ['city'],
      },
      execute: async () => '',
    };

    const pattern = generatePattern(tool);
    
    expect(pattern).toContain('weather');
    expect(pattern).toContain('<city:text>');
    expect(pattern).toContain('[days:number]');
  });

  it('应该使用自定义模式', () => {
    const tool: Tool = {
      name: 'custom',
      description: '',
      parameters: { type: 'object', properties: {} },
      command: { pattern: 'custom <arg1> [arg2]' },
      execute: async () => '',
    };

    expect(generatePattern(tool)).toBe('custom <arg1> [arg2]');
  });
});

describe('extractParamInfo 函数', () => {
  it('应该提取参数信息', () => {
    const params = extractParamInfo({
      type: 'object',
      properties: {
        name: { type: 'string', description: '名字' },
        age: { type: 'number', description: '年龄', default: 18 },
        gender: { type: 'string', enum: ['male', 'female'] },
      },
      required: ['name'],
    });

    expect(params).toHaveLength(3);
    
    const nameParam = params.find(p => p.name === 'name');
    expect(nameParam?.required).toBe(true);
    expect(nameParam?.type).toBe('string');
    
    const ageParam = params.find(p => p.name === 'age');
    expect(ageParam?.required).toBe(false);
    expect(ageParam?.default).toBe(18);
    
    const genderParam = params.find(p => p.name === 'gender');
    expect(genderParam?.enum).toEqual(['male', 'female']);
  });
});

describe('权限级别判断', () => {
  it('PERMISSION_LEVEL_PRIORITY 应该正确排序', () => {
    expect(PERMISSION_LEVEL_PRIORITY['user']).toBeLessThan(PERMISSION_LEVEL_PRIORITY['group_admin']);
    expect(PERMISSION_LEVEL_PRIORITY['group_admin']).toBeLessThan(PERMISSION_LEVEL_PRIORITY['group_owner']);
    expect(PERMISSION_LEVEL_PRIORITY['group_owner']).toBeLessThan(PERMISSION_LEVEL_PRIORITY['bot_admin']);
    expect(PERMISSION_LEVEL_PRIORITY['bot_admin']).toBeLessThan(PERMISSION_LEVEL_PRIORITY['owner']);
  });

  it('hasPermissionLevel 应该正确比较权限', () => {
    expect(hasPermissionLevel('owner', 'user')).toBe(true);
    expect(hasPermissionLevel('owner', 'owner')).toBe(true);
    expect(hasPermissionLevel('user', 'owner')).toBe(false);
    expect(hasPermissionLevel('group_admin', 'group_admin')).toBe(true);
    expect(hasPermissionLevel('group_admin', 'group_owner')).toBe(false);
  });

  it('inferPermissionLevel 应该正确推断权限', () => {
    expect(inferPermissionLevel({ isOwner: true } as ToolContext)).toBe('owner');
    expect(inferPermissionLevel({ isBotAdmin: true } as ToolContext)).toBe('bot_admin');
    expect(inferPermissionLevel({ isGroupOwner: true } as ToolContext)).toBe('group_owner');
    expect(inferPermissionLevel({ isGroupAdmin: true } as ToolContext)).toBe('group_admin');
    expect(inferPermissionLevel({} as ToolContext)).toBe('user');
    expect(inferPermissionLevel({ senderPermissionLevel: 'bot_admin' } as ToolContext)).toBe('bot_admin');
  });
});

describe('canAccessTool 函数', () => {
  const baseTool: Tool = {
    name: 'test',
    description: '',
    parameters: { type: 'object', properties: {} },
    execute: async () => '',
  };

  it('无限制的工具应该对所有人可用', () => {
    expect(canAccessTool(baseTool, {} as ToolContext)).toBe(true);
  });

  it('应该正确检查平台限制', () => {
    const tool: Tool = { ...baseTool, platforms: ['qq', 'telegram'] };
    
    expect(canAccessTool(tool, { platform: 'qq' } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, { platform: 'telegram' } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, { platform: 'discord' } as ToolContext)).toBe(false);
    expect(canAccessTool(tool, {} as ToolContext)).toBe(false);
  });

  it('应该正确检查场景限制', () => {
    const tool: Tool = { ...baseTool, scopes: ['group'] };
    
    expect(canAccessTool(tool, { scope: 'group' } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, { scope: 'private' } as ToolContext)).toBe(false);
  });

  it('应该正确检查权限级别', () => {
    const tool: Tool = { ...baseTool, permissionLevel: 'group_admin' };
    
    expect(canAccessTool(tool, { isGroupAdmin: true } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, { isGroupOwner: true } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, { isOwner: true } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, {} as ToolContext)).toBe(false);
  });

  it('应该组合检查所有条件', () => {
    const tool: Tool = {
      ...baseTool,
      platforms: ['qq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
    };

    // 全部满足
    expect(canAccessTool(tool, {
      platform: 'qq',
      scope: 'group',
      isGroupAdmin: true,
    } as ToolContext)).toBe(true);

    // 平台不满足
    expect(canAccessTool(tool, {
      platform: 'telegram',
      scope: 'group',
      isGroupAdmin: true,
    } as ToolContext)).toBe(false);

    // 场景不满足
    expect(canAccessTool(tool, {
      platform: 'qq',
      scope: 'private',
      isGroupAdmin: true,
    } as ToolContext)).toBe(false);

    // 权限不满足
    expect(canAccessTool(tool, {
      platform: 'qq',
      scope: 'group',
    } as ToolContext)).toBe(false);
  });

  it('空平台数组应该允许所有平台', () => {
    const tool: Tool = { ...baseTool, platforms: [] };
    
    expect(canAccessTool(tool, { platform: 'qq' } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, { platform: 'telegram' } as ToolContext)).toBe(true);
  });

  it('空场景数组应该允许所有场景', () => {
    const tool: Tool = { ...baseTool, scopes: [] };
    
    expect(canAccessTool(tool, { scope: 'group' } as ToolContext)).toBe(true);
    expect(canAccessTool(tool, { scope: 'private' } as ToolContext)).toBe(true);
  });
});

describe('ZhinTool 高级功能', () => {
  it('应该支持隐藏工具', () => {
    const tool = new ZhinTool('hidden_tool')
      .desc('隐藏工具')
      .hidden()
      .execute(async () => '');

    const toolObj = tool.toTool();
    expect(toolObj.hidden).toBe(true);
  });

  it('应该支持设置 hidden 为 false', () => {
    const tool = new ZhinTool('visible_tool')
      .desc('可见工具')
      .hidden(false)
      .execute(async () => '');

    const toolObj = tool.toTool();
    // hidden(false) 不会设置属性（默认就是不隐藏）
    expect(toolObj.hidden).toBeUndefined();
  });

  it('应该支持设置标签', () => {
    const tool = new ZhinTool('tagged_tool')
      .desc('带标签工具')
      .tag('utility', 'helper')
      .execute(async () => '');

    const toolObj = tool.toTool();
    expect(toolObj.tags).toContain('utility');
    expect(toolObj.tags).toContain('helper');
  });

  it('应该支持设置旧版权限', () => {
    const tool = new ZhinTool('permit_tool')
      .desc('权限工具')
      .permit('admin', 'operator')
      .execute(async () => '');

    const toolObj = tool.toTool();
    expect(toolObj.permissions).toContain('admin');
    expect(toolObj.permissions).toContain('operator');
  });

  it('应该支持自定义命令模式', () => {
    const tool = new ZhinTool('custom_pattern')
      .desc('自定义模式')
      .param('arg', { type: 'string' }, true)
      .pattern('custom <arg:rest>')
      .execute(async () => '')
      .action(async () => '');

    const toolObj = tool.toTool();
    expect((toolObj.command as any).pattern).toBe('custom <arg:rest>');
  });

  it('应该支持多次调用 param 更新参数', () => {
    const tool = new ZhinTool('update_param')
      .desc('更新参数')
      .param('name', { type: 'string', description: '原始描述' }, false)
      .param('name', { type: 'string', description: '新描述' }, true)
      .execute(async () => '');

    const params = tool.params;
    expect(params).toHaveLength(1);
    expect(params[0].schema.description).toBe('新描述');
    expect(params[0].required).toBe(true);
  });

  it('toJSON 应该返回正确的格式', () => {
    const tool = new ZhinTool('json_test')
      .desc('JSON 测试')
      .param('city', { type: 'string', description: '城市' }, true)
      .platform('qq')
      .scope('group')
      .permission('group_admin')
      .tag('test')
      .execute(async () => '');

    const json = tool.toJSON();
    
    expect(json.name).toBe('json_test');
    expect(json.description).toBe('JSON 测试');
    expect(json.parameters.properties).toHaveProperty('city');
    expect(json.platforms).toContain('qq');
    expect(json.scopes).toContain('group');
    expect(json.permissionLevel).toBe('group_admin');
    expect(json.tags).toContain('test');
    // execute 不应该在 JSON 中
    expect(json).not.toHaveProperty('execute');
  });

  it('toString 应该返回工具描述', () => {
    const tool = new ZhinTool('string_test')
      .desc('字符串测试')
      .execute(async () => '');

    const str = tool.toString();
    
    expect(str).toContain('string_test');
    expect(str).toContain('字符串测试');
  });

  it('多个场景应该正确设置', () => {
    const tool = new ZhinTool('multi_scope')
      .desc('多场景')
      .scope('group', 'private', 'channel')
      .execute(async () => '');

    const toolObj = tool.toTool();
    expect(toolObj.scopes).toEqual(['group', 'private', 'channel']);
  });

  it('多个平台应该正确设置', () => {
    const tool = new ZhinTool('multi_platform')
      .desc('多平台')
      .platform('qq', 'telegram', 'discord')
      .execute(async () => '');

    const toolObj = tool.toTool();
    expect(toolObj.platforms).toEqual(['qq', 'telegram', 'discord']);
  });

  it('默认权限级别应该是 user', () => {
    const tool = new ZhinTool('default_perm')
      .desc('默认权限')
      .execute(async () => '');

    const toolObj = tool.toTool();
    // 默认 user 不会设置到 toolObj
    expect(toolObj.permissionLevel).toBeUndefined();
  });
});

describe('generatePattern 边界情况', () => {
  it('应该处理没有 properties 的参数', () => {
    const tool: Tool = {
      name: 'no_props',
      description: '',
      parameters: { type: 'object' },
      execute: async () => '',
    };

    expect(generatePattern(tool)).toBe('no_props');
  });

  it('应该处理空 properties', () => {
    const tool: Tool = {
      name: 'empty_props',
      description: '',
      parameters: { type: 'object', properties: {} },
      execute: async () => '',
    };

    expect(generatePattern(tool)).toBe('empty_props');
  });

  it('应该正确处理 number 类型参数', () => {
    const tool: Tool = {
      name: 'number_param',
      description: '',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '数量' },
        },
        required: ['count'],
      },
      execute: async () => '',
    };

    const pattern = generatePattern(tool);
    expect(pattern).toContain('<count:number>');
  });

  it('应该正确处理自定义 paramType', () => {
    const tool: Tool = {
      name: 'custom_type',
      description: '',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', paramType: 'rest' as any },
        },
        required: ['content'],
      },
      execute: async () => '',
    };

    const pattern = generatePattern(tool);
    expect(pattern).toContain('<content:rest>');
  });
});

describe('extractParamInfo 边界情况', () => {
  it('应该处理空 properties', () => {
    const params = extractParamInfo({ type: 'object' });
    expect(params).toEqual([]);
  });

  it('应该处理没有 required 的参数', () => {
    const params = extractParamInfo({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    });

    expect(params).toHaveLength(1);
    expect(params[0].required).toBe(false);
  });

  it('应该处理空 required 数组', () => {
    const params = extractParamInfo({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: [],
    });

    expect(params[0].required).toBe(false);
  });
});

describe('ZhinTool 参数顺序', () => {
  it('必填参数应该排在可选参数前面', () => {
    const tool = new ZhinTool('ordered')
      .desc('参数顺序测试')
      .param('optional1', { type: 'string' }, false)
      .param('required1', { type: 'string' }, true)
      .param('optional2', { type: 'string' }, false)
      .param('required2', { type: 'string' }, true)
      .execute(async () => '');

    const toolObj = tool.toTool();
    const required = toolObj.parameters.required || [];
    
    expect(required).toContain('required1');
    expect(required).toContain('required2');
    expect(required).not.toContain('optional1');
    expect(required).not.toContain('optional2');
  });

  it('参数定义顺序应该保持', () => {
    const tool = new ZhinTool('keep_order')
      .desc('保持顺序')
      .param('a', { type: 'string' }, true)
      .param('b', { type: 'string' }, true)
      .param('c', { type: 'string' }, true)
      .execute(async () => '');

    const params = tool.params;
    expect(params.map(p => p.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('ZhinTool execute 执行', () => {
  it('应该正确执行 execute 函数', async () => {
    const tool = new ZhinTool('exec_test')
      .desc('执行测试')
      .param('name', { type: 'string' }, true)
      .execute(async (args) => `Hello, ${args.name}!`);

    const toolObj = tool.toTool();
    const result = await toolObj.execute({ name: 'World' });
    
    expect(result).toBe('Hello, World!');
  });

  it('execute 应该接收 context 参数', async () => {
    const mockContext: ToolContext = {
      platform: 'test',
      senderId: 'user1',
    };

    const tool = new ZhinTool('ctx_test')
      .desc('上下文测试')
      .execute(async (args, ctx) => ctx?.platform || 'no-platform');

    const toolObj = tool.toTool();
    const result = await toolObj.execute({}, mockContext);
    
    expect(result).toBe('test');
  });
});

describe('defineTool 高级用法', () => {
  it('应该支持禁用命令', () => {
    const tool = defineTool({
      name: 'no_cmd',
      description: '无命令',
      parameters: { type: 'object', properties: {} },
      command: false,
      execute: async () => '',
    });

    expect(tool.command).toBe(false);
  });

  it('应该支持设置权限', () => {
    const tool = defineTool({
      name: 'with_perm',
      description: '带权限',
      parameters: { type: 'object', properties: {} },
      permissions: ['admin'],
      permissionLevel: 'bot_admin',
      execute: async () => '',
    });

    expect(tool.permissions).toContain('admin');
    expect(tool.permissionLevel).toBe('bot_admin');
  });

  it('应该支持设置标签', () => {
    const tool = defineTool({
      name: 'with_tags',
      description: '带标签',
      parameters: { type: 'object', properties: {} },
      tags: ['utility', 'helper'],
      execute: async () => '',
    });

    expect(tool.tags).toContain('utility');
    expect(tool.tags).toContain('helper');
  });

  it('应该支持设置平台和场景', () => {
    const tool = defineTool({
      name: 'platform_scope',
      description: '平台场景',
      parameters: { type: 'object', properties: {} },
      platforms: ['qq'],
      scopes: ['group'],
      execute: async () => '',
    });

    expect(tool.platforms).toContain('qq');
    expect(tool.scopes).toContain('group');
  });

  it('应该支持 hidden 属性', () => {
    const tool = defineTool({
      name: 'hidden_tool',
      description: '隐藏工具',
      parameters: { type: 'object', properties: {} },
      hidden: true,
      execute: async () => '',
    });

    expect(tool.hidden).toBe(true);
  });

  it('应该支持 source 属性', () => {
    const tool = defineTool({
      name: 'sourced',
      description: '带来源',
      parameters: { type: 'object', properties: {} },
      source: 'plugin:my-plugin',
      execute: async () => '',
    });

    expect(tool.source).toBe('plugin:my-plugin');
  });
});

describe('权限系统完整测试', () => {
  it('owner 权限应该高于所有其他权限', () => {
    expect(hasPermissionLevel('owner', 'user')).toBe(true);
    expect(hasPermissionLevel('owner', 'group_admin')).toBe(true);
    expect(hasPermissionLevel('owner', 'group_owner')).toBe(true);
    expect(hasPermissionLevel('owner', 'bot_admin')).toBe(true);
    expect(hasPermissionLevel('owner', 'owner')).toBe(true);
  });

  it('user 权限应该只能访问 user 级别工具', () => {
    expect(hasPermissionLevel('user', 'user')).toBe(true);
    expect(hasPermissionLevel('user', 'group_admin')).toBe(false);
    expect(hasPermissionLevel('user', 'group_owner')).toBe(false);
    expect(hasPermissionLevel('user', 'bot_admin')).toBe(false);
    expect(hasPermissionLevel('user', 'owner')).toBe(false);
  });

  it('group_admin 可以访问 user 和 group_admin 级别', () => {
    expect(hasPermissionLevel('group_admin', 'user')).toBe(true);
    expect(hasPermissionLevel('group_admin', 'group_admin')).toBe(true);
    expect(hasPermissionLevel('group_admin', 'group_owner')).toBe(false);
  });

  it('bot_admin 可以访问除 owner 外的所有级别', () => {
    expect(hasPermissionLevel('bot_admin', 'user')).toBe(true);
    expect(hasPermissionLevel('bot_admin', 'group_admin')).toBe(true);
    expect(hasPermissionLevel('bot_admin', 'group_owner')).toBe(true);
    expect(hasPermissionLevel('bot_admin', 'bot_admin')).toBe(true);
    expect(hasPermissionLevel('bot_admin', 'owner')).toBe(false);
  });

  it('inferPermissionLevel 应该优先使用 senderPermissionLevel', () => {
    expect(inferPermissionLevel({
      senderPermissionLevel: 'owner',
      isGroupAdmin: true,
    } as ToolContext)).toBe('owner');
  });

  it('inferPermissionLevel 在无任何权限时返回 user', () => {
    expect(inferPermissionLevel({
      isGroupAdmin: false,
      isGroupOwner: false,
      isBotAdmin: false,
      isOwner: false,
    } as ToolContext)).toBe('user');
  });
});
