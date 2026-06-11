/**
 * Advanced ACCEPTANCE 自动化契约（examples/test-bot/ACCEPTANCE.md Advanced 段）。
 * QQ 实机与真实 LLM 仍须手测；此处覆盖可 Vitest 断言的项。
 */
import { describe, it, expect } from 'vitest';
import { mockCommMessage } from './helpers/mock-comm-message.js';
import type { AgentTool } from '@zhin.js/ai';
import { estimateTokens } from '@zhin.js/ai';
import {
  DEFAULT_CONFIG,
  DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS,
} from '../src/zhin-agent/config.js';
import { buildOrchestratorAgentTools } from '../src/zhin-agent/tool-search-orchestrator.js';
import { buildRichSystemPrompt } from '../src/zhin-agent/prompt.js';
import { buildAgentPathSystemPrompt } from '../src/zhin-agent/prompt-assembly.js';
import { asPrivate } from '../src/zhin-agent/zhin-agent-private.js';
import { ZhinAgent } from '../src/zhin-agent/index.js';
import { createIcqqAgentPromptContributor } from '../../../../plugins/adapters/icqq/src/agent-prompt.js';

function makeTool(name: string): AgentTool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async () => name,
  };
}

const mockProvider = {
  name: 'mock',
  models: [],
  chat: async () => ({ choices: [{ message: { content: '' } }] }),
  chatStream: async function* () {},
} as any;

describe('Advanced ACCEPTANCE (automated)', () => {
  it('主编排常驻含 spawn_task 与 web_search，generate_image 在 deferred', () => {
    const built = buildOrchestratorAgentTools({
      allTools: [
        makeTool('ask_user'),
        makeTool('web_search'),
        makeTool('generate_image'),
        makeTool('github_star'),
        makeTool('bash'),
        makeTool('weather'),
      ],
      config: DEFAULT_CONFIG,
      commMessage: mockCommMessage({ adapter: 'test' }),
      subagentManager: { spawn: async () => 'queued' } as any,
      getDeferredCatalog: () => [],
      runWorker: async () => '{"summary":"ok"}',
    });
    expect(built.orchestratorTools.map(t => t.name)).toEqual([
      ...DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS,
    ]);
    expect(built.orchestratorTools.map(t => t.name)).toContain('web_search');
    expect(built.orchestratorTools.map(t => t.name)).not.toContain('generate_image');
    expect(built.deferred.some(t => t.name === 'generate_image')).toBe(true);
  });

  it('主编排 system prompt 估算 token < 20k', async () => {
    const agent = new ZhinAgent(mockProvider, {
      ...DEFAULT_CONFIG,
      persona: '测试',
    });
    const host = asPrivate(agent);
    const prompt = await buildAgentPathSystemPrompt(host, {
      content: '查 github star',
      commMessage: mockCommMessage({ adapter: 'icqq', senderId: 'u1', scope: 'group', sceneId: 'g1' }),
      sessionId: 'icqq:g1:u1',
      personaEnhanced: 'persona',
      deferredStats: 'github(3)',
    });
    const tokens = estimateTokens({ role: 'system', content: prompt });
    expect(tokens).toBeLessThan(20_000);
  });

  it('通用 rich prompt 无 mcp_icqq 硬编码', () => {
    const prompt = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: 'x'.repeat(2000),
    });
    expect(prompt).not.toMatch(/mcp_icqq/);
    expect(prompt).toContain('run_deferred_task');
  });

  it('icqq 平台段经 contributor 注入 # Platform（非 prompt.ts 硬编码）', async () => {
    const contributor = createIcqqAgentPromptContributor();
    const sections = await contributor.buildSections({
      slot: 'orchestrator',
      commMessage: mockCommMessage({ adapter: 'icqq' }),
    });
    expect(sections?.[0].body).toMatch(/# Platform|mcp_icqq/);
    const rich = buildRichSystemPrompt({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      platformSections: sections?.map(s => s.body).join('\n'),
    });
    expect(rich).toContain('# Platform');
  });
});
