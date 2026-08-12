import type { Message } from '../orchestrator/types.js';
import { resolveAgentPromptMarkdown } from '../agent-prompt/index.js';
import {
  buildRichSystemPrompt,
  buildLiteSystemPromptWithPlatform,
  buildUserMessageWithHistory,
  FIXED_DISCIPLINE_RULES,
  describePromptSectionsForDebug,
  type PromptSectionDebugInfo,
} from './system-prompt.js';
import { resolveWorkspacePrompt } from './workspace-prompt.js';
import { getGitStatusLine } from './git-context.js';
import { buildPreExecFastPathPrompt } from '../tool/runtime.js';
import type { AgentContextHost, ZhinAgentPrivate } from '../internal/agent-host.js';
import { getLlmTransportModel, type AgentMessage } from '@zhin.js/ai';
import { getScheduleTurnContext } from '../internal/turn-context.js';
import { assembleSchedulePrompt } from '../schedule-domain/prompt-assembler.js';
import { getFileMemoryContext } from '../memory-layers.js';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';

function scheduleSystemPrompt(
  agent: ZhinAgentPrivate,
  commMessage: Message,
  platformContext?: string,
): string | null {
  const context = getScheduleTurnContext();
  if (!context?.jobId) return null;
  const platform = String(commMessage.$adapter);
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  return assembleSchedulePrompt({
    jobId: context.jobId,
    prompt: context.executionPlan?.prompt ?? '',
    createdBy: context.createdBy,
    security: context.security,
    platformContext,
    memoryContext: getFileMemoryContext(undefined, platform, sessionKey),
    skillContext: agent.getTurnActiveSkills(),
    bootstrapContext: [agent.globalContext, agent.bootstrapContext].filter(Boolean).join('\n\n'),
  }).systemPrompt;
}

export function buildDisciplinedPrompt(_host: AgentContextHost, basePrompt: string): string {
  const guidance = [
    '# Style',
    '- Lead with the answer or result.',
    '- Be concise, direct, and useful.',
    '',
    '# Safety',
    ...FIXED_DISCIPLINE_RULES.map(rule => `- ${rule}`),
  ].join('\n');
  return `${basePrompt}\n\n${guidance}`;
}

export async function describeAgentPathPromptSections(
  agent: ZhinAgentPrivate,
  options: {
    commMessage: Message;
    content: string;
    sessionId: string;
    deferredStats?: string;
    modelSdk?: string;
  },
): Promise<PromptSectionDebugInfo[]> {
  const platformMarkdown = await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      commMessage: options.commMessage,
      userMessagePreview: options.content.slice(0, 500),
      deferred: options.deferredStats
        ? { goal: options.content, domainStats: options.deferredStats }
        : undefined,
    },
    config: agent.config,
    sessionId: options.sessionId,
  });

  return describePromptSectionsForDebug({
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    activeSkillsContext: agent.getTurnActiveSkills(),
    bootstrapContext: agent.bootstrapContext,
    globalContext: agent.globalContext,
    commMessage: options.commMessage,
    gitStatus: agent.config.gitStatus
      ? (await getGitStatusLine(process.cwd())) ?? undefined
      : undefined,
    toolSearchDeferredStats: options.deferredStats,
    platformSections: platformMarkdown,
    orchestratorSdk: options.modelSdk,
    agentNickname: agent.activeBinding?.nickname,
  });
}

export async function buildAgentPathSystemPrompt(
  agent: ZhinAgentPrivate,
  options: {
    content: string;
    commMessage: Message;
    sessionId: string;
    personaEnhanced: string;
    preData?: string;
    deferredStats?: string;
    modelSdk?: string;
  },
): Promise<string> {
  const { content, commMessage, sessionId, personaEnhanced, preData, deferredStats, modelSdk } = options;

  const platformMarkdown = await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      commMessage,
      userMessagePreview: content.slice(0, 500),
      deferred: deferredStats ? { goal: content, domainStats: deferredStats } : undefined,
    },
    config: agent.config,
    sessionId,
  });

  const schedulePrompt = scheduleSystemPrompt(agent, commMessage, platformMarkdown);
  if (schedulePrompt) return schedulePrompt;

  const gitStatus = agent.config.gitStatus
    ? await getGitStatusLine(process.cwd())
    : null;

  const bindingModel = agent.activeBinding?.model;
  const providerAlias = agent.activeBinding?.providerAlias ?? agent.getTurnProvider().name;
  const llmModel = bindingModel
    ? getLlmTransportModel(providerAlias, bindingModel)
    : undefined;

  const promptCtx = {
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    activeSkillsContext: agent.getTurnActiveSkills(),
    bootstrapContext: agent.bootstrapContext,
    globalContext: agent.globalContext,
    commMessage,
    gitStatus: gitStatus ?? undefined,
    toolSearchDeferredStats: deferredStats,
    platformSections: platformMarkdown,
    orchestratorSdk: modelSdk,
    agentNickname: agent.activeBinding?.nickname,
    modelId: bindingModel,
    contextWindow: llmModel?.contextWindow ?? agent.config.contextTokens,
  };
  const richPrompt = buildRichSystemPrompt(promptCtx);

  const dynamicBlock = agent.turnDynamicInstructions?.trim();
  const dynamicSuffix = dynamicBlock ? `\n\n# Dynamic context\n${dynamicBlock}` : '';

  return `${richPrompt}${dynamicSuffix}${preData ? `\n\nPre-fetched data:\n${preData}` : ''}`;
}

export function buildFastPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  preData: string | undefined,
  _commMessage: Message,
): string {
  const schedulePrompt = scheduleSystemPrompt(agent, _commMessage);
  if (schedulePrompt) return schedulePrompt;
  return buildDisciplinedPrompt(agent, buildPreExecFastPathPrompt(personaEnhanced, preData ?? ''));
}

export function buildChatPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  _commMessage: Message,
): string {
  const schedulePrompt = scheduleSystemPrompt(agent, _commMessage);
  if (schedulePrompt) return schedulePrompt;
  return buildDisciplinedPrompt(agent, personaEnhanced);
}

export async function buildMultimodalVisionSystemPrompt(
  agent: ZhinAgentPrivate,
  options: {
    commMessage: Message;
    sessionId: string;
    textContent: string;
    personaEnhanced: string;
  },
): Promise<string> {
  const { commMessage, sessionId, textContent, personaEnhanced } = options;
  const platformMarkdown = await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      commMessage,
      userMessagePreview: textContent.slice(0, 500),
    },
    config: agent.config,
    sessionId,
  });
  return buildLiteSystemPromptWithPlatform(
    personaEnhanced,
    platformMarkdown,
  );
}

export function buildAgentUserMessage(
  historyMessages: AgentMessage[],
  content: string,
): string {
  return buildUserMessageWithHistory(historyMessages, content);
}
