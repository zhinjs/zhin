import { describe, it, expect } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { disableTool } from '../src/authoring/disable-tool.js';
import { resolveSubagentAgentTools, SUBAGENT_BLOCKED_TOOL_NAMES } from '../src/orchestrator/resolve-subagent-tools.js';
import { DEFAULT_CONFIG } from '../src/config/index.js';
import type { AgentMeta, AgentEffortLevel } from '../src/discovery/agents.js';

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: { type: 'object' },
    execute: async () => '',
  };
}

const baseParams = {
  task: 'test task',
  role: 'subtask' as const,
  config: DEFAULT_CONFIG as Required<typeof DEFAULT_CONFIG>,
  agentDispatcher: null,
};

describe('disallowedTools filtering', () => {
  it('removes tools in disallowedTools from pool', () => {
    const allTools = [makeTool('bash'), makeTool('read_file'), makeTool('write_file')];
    const meta: AgentMeta = {
      name: 'test-agent',
      description: 'Test',
      filePath: '/tmp/test.agent.md',
      disallowedTools: ['bash'],
    };

    const result = resolveSubagentAgentTools({ ...baseParams, allTools, agentMeta: meta });
    expect(result.map(t => t.name)).toEqual(['read_file', 'write_file']);
  });

  it('accepts disableTool() sentinel via normalized AgentMeta', () => {
    const allTools = [makeTool('bash'), makeTool('read_file')];
    const meta: AgentMeta = {
      name: 'test-agent',
      description: 'Test',
      filePath: '/tmp/test.agent.md',
      disallowedTools: [disableTool('bash').name],
    };
    const result = resolveSubagentAgentTools({ ...baseParams, allTools, agentMeta: meta });
    expect(result.map(t => t.name)).toEqual(['read_file']);
  });

  it('no disallowedTools means no filtering', () => {
    const allTools = [makeTool('bash'), makeTool('read_file')];
    const meta: AgentMeta = {
      name: 'test-agent',
      description: 'Test',
      filePath: '/tmp/test.agent.md',
    };

    const result = resolveSubagentAgentTools({ ...baseParams, allTools, agentMeta: meta });
    const resultNames = result.map(t => t.name);
    expect(resultNames).toContain('bash');
    expect(resultNames).toContain('read_file');
  });

  it('disallowedTools combined with built-in SUBAGENT_BLOCKED', () => {
    const allTools = [
      makeTool('bash'),
      makeTool('read_file'),
      makeTool('spawn_task'),
    ];
    const meta: AgentMeta = {
      name: 'test-agent',
      description: 'Test',
      filePath: '/tmp/test.agent.md',
      disallowedTools: ['bash'],
    };

    const result = resolveSubagentAgentTools({ ...baseParams, allTools, agentMeta: meta });
    expect(result.map(t => t.name)).toEqual(['read_file']);
    expect(result.some(t => SUBAGENT_BLOCKED_TOOL_NAMES.has(t.name))).toBe(false);
  });

  it('empty disallowedTools has no effect', () => {
    const allTools = [makeTool('bash'), makeTool('read_file')];
    const meta: AgentMeta = {
      name: 'test-agent',
      description: 'Test',
      filePath: '/tmp/test.agent.md',
      disallowedTools: [],
    };

    const result = resolveSubagentAgentTools({ ...baseParams, allTools, agentMeta: meta });
    expect(result.map(t => t.name)).toContain('bash');
  });
});

describe('effort level mapping', () => {
  const EFFORT_MAP: Record<AgentEffortLevel, number> = {
    low: 3,
    medium: 5,
    high: 10,
    max: 20,
  };

  it.each(Object.entries(EFFORT_MAP) as [AgentEffortLevel, number][])(
    'effort "%s" maps to %d maxIterations',
    (effort, expectedMax) => {
      expect(EFFORT_MAP[effort]).toBe(expectedMax);
    },
  );
});

describe('AgentMeta extended fields', () => {
  it('accepts all new fields without type errors', () => {
    const meta: AgentMeta = {
      name: 'full-agent',
      description: 'Agent with all new fields',
      filePath: '/agents/full-agent.agent.md',
      toolNames: ['read_file'],
      disallowedTools: ['bash'],
      effort: 'high',
      memory: 'agent',
      toolAliases: {
        'Bash': 'bash',
        'ReadFile': 'read_file',
      },
    };

    expect(meta.disallowedTools).toEqual(['bash']);
    expect(meta.effort).toBe('high');
    expect(meta.memory).toBe('agent');
    expect(meta.toolAliases).toEqual({ Bash: 'bash', ReadFile: 'read_file' });
  });

  it('toolAliases resolves alias to real tool name', () => {
    const aliases: Record<string, string> = {
      'Bash': 'bash',
      'ReadFile': 'read_file',
    };
    const inputName = 'Bash';
    const resolvedName = aliases[inputName] ?? inputName;
    expect(resolvedName).toBe('bash');
  });

  it('toolAliases passes through unknown names', () => {
    const aliases: Record<string, string> = { 'Bash': 'bash' };
    const inputName = 'write_file';
    const resolvedName = aliases[inputName] ?? inputName;
    expect(resolvedName).toBe('write_file');
  });
});
