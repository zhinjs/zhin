import type { Message } from '../orchestrator/types.js';
import { resolveAgentPromptMarkdown } from '../agent-prompt/index.js';
import {
  buildRichSystemPrompt,
  buildLiteSystemPromptWithPlatform,
  buildUserMessageWithHistory,
  FIXED_DISCIPLINE_RULES,
  describePromptSectionsForDebug,
  type PromptSectionDebugInfo,
} from './prompt.js';
import { resolveWorkspacePrompt } from './workspace-prompt.js';
import { buildPreExecFastPathPrompt } from './tool-runtime.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';
import type { AgentMessage } from '@zhin.js/ai';

export function buildDisciplinedPrompt(_agent: ZhinAgentPrivate, basePrompt: string): string {
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
    activeSkillsContext: agent.activeSkillsContext,
    bootstrapContext: agent.bootstrapContext,
    commMessage: options.commMessage,
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

  const promptCtx = {
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    activeSkillsContext: agent.activeSkillsContext,
    bootstrapContext: agent.bootstrapContext,
    commMessage,
    toolSearchDeferredStats: deferredStats,
    platformSections: platformMarkdown,
    orchestratorSdk: modelSdk,
    agentNickname: agent.activeBinding?.nickname,
  };
  const richPrompt = buildRichSystemPrompt(promptCtx);

  return `${richPrompt}${preData ? `\n\nPre-fetched data:\n${preData}` : ''}`;
}

export function buildFastPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  preData: string | undefined,
  _commMessage: Message,
): string {
  return buildDisciplinedPrompt(agent, buildPreExecFastPathPrompt(personaEnhanced, preData ?? ''));
}

export function buildChatPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  _commMessage: Message,
): string {
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
