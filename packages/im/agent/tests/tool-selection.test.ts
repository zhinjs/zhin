import { describe, expect, it } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import {
  ToolSelection,
  canAccessTool,
  canAccessToolFromSkill,
  createRestrictedToolView,
  normalizeTool,
} from '../src/orchestrator/tool-selection.js';
import { planToolRun } from '../src/zhin-agent/tool-runtime.js';
import type { Tool, ToolContext } from '../src/orchestrator/types.js';
import type { ZhinAgentConfig } from '../src/zhin-agent/config.js';

function makeConfig(overrides: Partial<ZhinAgentConfig> = {}): Required<ZhinAgentConfig> {
  return {
    persona: '',
    maxIterations: 5,
    timeout: 60000,
    preExecTimeout: 10000,
    maxSkills: 3,
    maxTools: 8,
    minTopicRounds: 5,
    slidingWindowSize: 5,
    topicChangeThreshold: 0.15,
    rateLimit: {},
    toneAwareness: true,
    chatModel: '',
    chatLiteModel: '',
    visionModel: '',
    contextTokens: 4096,
    maxHistoryShare: 0.5,
    disabledTools: [],
    allowedTools: [],
    execSecurity: 'deny',
    execPreset: 'custom',
    execAllowlist: [],
    execApprovalMode: 'deny',
    subagentExecApprovalMode: 'deny',
    workerExecApprovalMode: 'deny',
    taskExecApprovalMode: 'deny',
    maxSubagentIterations: 15,
    subagentTools: [],
    modelSizeHint: '',
    skillInstructionMaxChars: 0,
    ...overrides,
  };
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'read_file',
    description: 'read file from disk',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'file path' },
      },
      required: ['path'],
    },
    execute: async args => args,
    ...overrides,
  };
}

describe('tool-selection permissions', () => {
  it('checks platform, scope and requiredAnyRole in one place', () => {
    const tool = makeTool({
      platforms: ['qq'],
      scopes: ['group'],
      requiredAnyRole: ['group_admin'],
    });

    expect(canAccessTool(tool, { platform: 'qq', scope: 'group', roles: ['group_admin'] })).toBe(true);
    expect(canAccessTool(tool, { platform: 'qq', scope: 'private', roles: ['group_admin'] })).toBe(false);
    expect(canAccessTool(tool, { platform: 'qq', scope: 'group' })).toBe(false);
  });

  it('canAccessToolFromSkill ignores platform but keeps scope and permission', () => {
    const tool = makeTool({
      platforms: ['github'],
      scopes: ['private'],
    });

    expect(canAccessToolFromSkill(tool, { platform: 'qq', scope: 'private' })).toBe(true);
    expect(canAccessToolFromSkill(tool, { platform: 'qq', scope: 'group' })).toBe(false);
    expect(canAccessTool(tool, { platform: 'qq', scope: 'private' })).toBe(false);
  });
});

describe('normalizeTool', () => {
  it('preserves agent metadata and requiredAnyRole', () => {
    const agentTool = normalizeTool(makeTool({
      tags: ['files'],
      keywords: ['read'],
      requiredAnyRole: ['trusted'],
      preExecutable: true,
      kind: 'builtin',
    }));

    expect(agentTool.tags).toEqual(['files']);
    expect(agentTool.keywords).toEqual(['read']);
    expect(agentTool.requiredAnyRole).toEqual(['trusted']);
    expect(agentTool.preExecutable).toBe(true);
    expect(agentTool.kind).toBe('builtin');
  });

  it('injects contextKey parameters and hides them from the model schema', async () => {
    const tool = makeTool({
      parameters: {
        type: 'object',
        properties: {
          sceneId: { type: 'string', contextKey: 'sceneId' },
          count: { type: 'number', contextKey: 'count' },
          query: { type: 'string' },
        },
        required: ['sceneId', 'count', 'query'],
      },
      execute: async args => args,
    });
    const agentTool = normalizeTool(tool, { sceneId: 'room-1', count: '2' } as ToolContext);

    expect(agentTool.parameters.properties).toEqual({ query: { type: 'string' } });
    expect(agentTool.parameters.required).toEqual(['query']);
    await expect(agentTool.execute({ query: 'hello' })).resolves.toEqual({
      query: 'hello',
      sceneId: 'room-1',
      count: 2,
    });
  });

  it('passes context to tools even when no contextKey parameters are declared', async () => {
    const tool = makeTool({
      execute: async (_args, context) => context?.senderId,
    });
    const agentTool = normalizeTool(tool, { senderId: 'u1' });

    await expect(agentTool.execute({ path: 'a.txt' })).resolves.toBe('u1');
  });

  it('preserves Tool.source on AgentTool (reserved-name merge / builtin detection)', () => {
    const tool = makeTool({ source: 'builtin:agent' });
    const agentTool = normalizeTool(tool);
    expect(agentTool.source).toBe('builtin:agent');
  });
});

describe('ToolSelection', () => {
  it('owns relevance cache for agent-side filtering', () => {
    const selection = new ToolSelection();
    const tools: AgentTool[] = [
      normalizeTool(makeTool({ name: 'web_search', description: 'search web', keywords: ['search'] })),
      normalizeTool(makeTool({ name: 'read_file', description: 'read file', keywords: ['file'] })),
    ];

    selection.filterByRelevance('search the web', tools);
    selection.filterByRelevance('search the web', tools);

    expect(selection.cacheSize).toBe(1);
    selection.invalidate();
    expect(selection.cacheSize).toBe(0);
  });

  it('collects tools with skill priority, support tools and allow filtering', () => {
    const selection = new ToolSelection();
    const context: ToolContext = { platform: 'qq', scope: 'group' };
    const externalTools = [
      makeTool({ name: 'activate_skill', description: 'activate skill', keywords: ['deploy'] }),
      makeTool({ name: 'bash', description: 'run shell command', keywords: ['shell'] }),
      makeTool({ name: 'web_search', description: 'search web', keywords: ['search'] }),
      makeTool({ name: 'blocked', description: 'blocked tool', requiredAnyRole: ['master'], keywords: ['blocked'] }),
    ];
    const skillTool = makeTool({ name: 'deploy_tool', description: 'deploy app', keywords: ['deploy'] });
    const deploySkill = { name: 'deploy', description: 'deploy', tools: [skillTool], pluginName: 'test', keywords: ['deploy'] };
    const skillRegistry = {
      size: 1,
      getAll: () => [deploySkill],
      getByName: (name: string) => (name === 'deploy' ? deploySkill : undefined),
      search: () => [deploySkill],
    };

    const tools = selection.collectRelevantTools('please deploy this app', context, externalTools, {
      config: makeConfig({ allowedTools: ['activate_skill', 'bash', 'deploy_tool'] }),
      skillRegistry: skillRegistry as any,
      externalRegistered: new Map(),
    });

    expect(tools.map(t => t.name)).toEqual(['activate_skill', 'deploy_tool', 'bash']);
    expect(tools.some(t => t.name === 'blocked')).toBe(false);
  });

  it('消息命中技能关键词时注入该技能工具（跨 IM 平台，如 QQ 上用 github_star）', () => {
    const selection = new ToolSelection();
    const context: ToolContext = { platform: 'qq', scope: 'private' };
    const externalTools = [
      makeTool({ name: 'activate_skill', description: 'activate a skill by name', keywords: [] }),
      makeTool({ name: 'bash', description: 'run shell', keywords: [] }),
    ];
    const githubStar = makeTool({
      name: 'github_star',
      description: 'star a repo',
      platforms: ['github'],
      keywords: ['star'],
    });
    const skillsList = [
      {
        name: 'github',
        description: 'github ops',
        tools: [githubStar],
        pluginName: 'adapter-github',
        platforms: ['github'],
        keywords: ['star', 'github'],
      },
    ];
    const skillRegistry = {
      size: 1,
      getAll: () => skillsList,
      getByName: (name: string) => skillsList.find(s => s.name === name),
      search: () => [],
    };

    const tools = selection.collectRelevantTools('查看 zhinjs/qq-official-bot 的 star 数', context, externalTools, {
      config: makeConfig({ maxSkills: 5, maxTools: 20 }),
      skillRegistry: skillRegistry as any,
      externalRegistered: new Map(),
    });

    expect(tools.map(t => t.name)).toContain('github_star');
    expect(tools.map(t => t.name)).toContain('activate_skill');
  });

  it('当 context.platform 命中技能 platforms 时自动注入 activate_skill（消息无需含技能名）', () => {
    const selection = new ToolSelection();
    const context: ToolContext = { platform: 'icqq' };
    const externalTools = [
      makeTool({ name: 'activate_skill', description: 'activate a skill by name', keywords: [] }),
      makeTool({ name: 'bash', description: 'run shell', keywords: [] }),
    ];
    const icqqAux = makeTool({ name: 'icqq_status_tool', description: 'qq status', keywords: [] });
    const skillsList = [
      {
        name: 'icqq',
        description: 'icqq cli skill',
        tools: [icqqAux],
        pluginName: 'adapter-icqq',
        platforms: ['icqq'],
        keywords: [],
      },
    ];
    const skillRegistry = {
      size: 1,
      getAll: () => skillsList,
      getByName: (name: string) => skillsList.find(s => s.name === name),
      search: () => [],
    };

    const tools = selection.collectRelevantTools('帮我看看今天天气', context, externalTools, {
      config: makeConfig({ maxSkills: 5, maxTools: 12 }),
      skillRegistry: skillRegistry as any,
      externalRegistered: new Map(),
    });

    expect(tools[0]?.name).toBe('activate_skill');
    expect(tools.map(t => t.name)).toContain('icqq_status_tool');
    expect(tools.map(t => t.name)).toContain('bash');
  });

  it('retains web_search after relevance filter for messages without search keywords', () => {
    const selection = new ToolSelection();
    const context: ToolContext = { platform: 'qq' };
    const externalTools = [
      makeTool({ name: 'web_search', description: 'Bing HTML search', keywords: ['search', 'bing'] }),
    ];
    const tools = selection.collectRelevantTools('狐蒂云最近有什么动态', context, externalTools, {
      config: makeConfig(),
      skillRegistry: null,
      externalRegistered: new Map(),
    });
    expect(tools.some(t => t.name === 'web_search')).toBe(true);
  });

  it('retains ask_user after relevance filter for messages without interaction keywords', () => {
    const selection = new ToolSelection();
    const context: ToolContext = { platform: 'qq' };
    const externalTools = [
      makeTool({ name: 'ask_user', description: 'Ask bot owner', keywords: ['owner', 'confirm'] }),
    ];
    const tools = selection.collectRelevantTools('今天天气适合出门吗', context, externalTools, {
      config: makeConfig(),
      skillRegistry: null,
      externalRegistered: new Map(),
    });
    expect(tools.some(t => t.name === 'ask_user')).toBe(true);
  });
});

describe('restricted tool views and pre-exec plans', () => {
  it('derives a restricted subagent tool view from agent tools', () => {
    const tools = [
      normalizeTool(makeTool({ name: 'read_file', description: 'read files' })),
      normalizeTool(makeTool({ name: 'bash', description: 'run shell' })),
      normalizeTool(makeTool({ name: 'spawn_task', description: 'spawn task' })),
      normalizeTool(makeTool({ name: 'read_file', description: 'duplicate read files' })),
    ];

    expect(createRestrictedToolView(tools).map(tool => tool.name)).toEqual(['read_file', 'bash']);
    expect(createRestrictedToolView(tools, {
      allowedNames: ['read_file', 'spawn_task'],
      disabledNames: ['spawn_task'],
    }).map(tool => tool.name)).toEqual(['read_file']);
  });

  it('plans pre-executable fast path in the same tool runtime seam', async () => {
    const preTool = normalizeTool(makeTool({
      name: 'context_fetch',
      description: 'fetch context',
      preExecutable: true,
      execute: async () => 'fresh context',
    }));
    const plan = await planToolRun([preTool], 100);

    expect(plan.mode).toBe('pre-exec-fast-path');
    expect(plan.preExecTools.map(tool => tool.name)).toEqual(['context_fetch']);
    expect(plan.preExecution.data).toContain('fresh context');
  });

  it('keeps mixed pre-executable and normal tools on the agent path', async () => {
    const preTool = normalizeTool(makeTool({
      name: 'context_fetch',
      description: 'fetch context',
      preExecutable: true,
      execute: async () => 'fresh context',
    }));
    const normalTool = normalizeTool(makeTool({ name: 'read_file', description: 'read files' }));
    const plan = await planToolRun([preTool, normalTool], 100);

    expect(plan.mode).toBe('agent');
    expect(plan.hasNonPreExecTools).toBe(true);
  });
});
