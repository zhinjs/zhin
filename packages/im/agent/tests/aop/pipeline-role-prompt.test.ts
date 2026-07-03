import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '@zhin.js/core';
import { buildPipelineRoleRichSystemPrompt } from '../../src/zhin-agent/prompt.js';
import { resolvePipelineRoleForTurn } from '../../src/aop/pipeline/resolve-pipeline-role-for-turn.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { MemoryCollaborationSceneRepository } from '../../src/collaboration/collaboration-scene-repository.js';
import type { ZhinAgentConfig } from '../../src/zhin-agent/config.js';
import type { ResolvedAgentBinding } from '../../src/config/types.js';

const minimalConfig = {
  persona: 'You are Zhin, an intelligent IM assistant.',
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
} as Required<ZhinAgentConfig>;

function groupMessage(endpoint: string): Message {
  return {
    $adapter: 'icqq',
    $endpoint: endpoint,
    $channel: { type: 'group', id: '373460458' },
    $sender: { id: 'user1' },
    $content: [],
  } as Message;
}

describe('buildPipelineRoleRichSystemPrompt', () => {
  it('injects role identity plus Security/Style/Tools, skips generic persona and SOUL', () => {
    const prompt = buildPipelineRoleRichSystemPrompt({
      config: minimalConfig,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '## SOUL.md\nBe warm and helpful.',
      pipelineRole: 'planner',
      agentNickname: '小智',
      platformSections: '## ICQQ\nUse group mentions.',
    });

    expect(prompt).toContain('小智');
    expect(prompt).toContain('Planner');
    expect(prompt).toContain('# Security');
    expect(prompt).toContain('# Style');
    expect(prompt).toContain('# Tools');
    expect(prompt).toContain('# Platform');
    expect(prompt).toContain('ICQQ');
    expect(prompt).not.toContain('SOUL.md');
    expect(prompt).not.toContain('You are Zhin');
  });

  it('uses evaluator-specific role copy', () => {
    const prompt = buildPipelineRoleRichSystemPrompt({
      config: minimalConfig,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: '',
      pipelineRole: 'evaluator',
      agentNickname: '分析师',
    });

    expect(prompt).toContain('分析师');
    expect(prompt).toContain('Evaluator');
    expect(prompt).toContain('decision summary');
    expect(prompt).not.toContain('cell_submit_artifact');
  });
});

describe('resolvePipelineRoleForTurn', () => {
  beforeEach(async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    await repo.upsert({
      id: 'icqq-collab',
      adapter: 'icqq',
      sceneId: '373460458',
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'executor', pipelineRole: 'executor' },
      ],
    });
    getCollaborationSceneService().setRepository(repo);
    await getCollaborationSceneService().reloadFromRepository();
  });

  it('reads pipelineRole from cell member endpoint', () => {
    expect(resolvePipelineRoleForTurn(null, groupMessage('210723495'))).toBe('executor');
  });

  it('falls back to activeBinding name when no cell match', () => {
    const binding = { name: 'researcher', providerAlias: 'agnes', model: 'flash' } as ResolvedAgentBinding;
    expect(resolvePipelineRoleForTurn(binding, undefined)).toBe('researcher');
  });
});
