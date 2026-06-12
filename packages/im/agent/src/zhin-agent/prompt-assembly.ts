import type { Message } from '../orchestrator/types.js';
import { resolveAgentPromptMarkdown } from '../agent-prompt/index.js';
import {
  buildEnhancedPersona,
  formatSessionContextLine,
  appendQuoteContextSystemHint,
  buildRichSystemPrompt,
  buildLiteSystemPromptWithPlatform,
  buildUserMessageWithHistory,
  FIXED_DISCIPLINE_RULES,
} from './prompt.js';
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

export async function buildAgentPathSystemPrompt(
  agent: ZhinAgentPrivate,
  options: {
    content: string;
    commMessage: Message;
    sessionId: string;
    personaEnhanced: string;
    preData?: string;
    deferredStats?: string;
  },
): Promise<string> {
  const { content, commMessage, sessionId, personaEnhanced, preData, deferredStats } = options;

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

  const richPrompt = buildRichSystemPrompt({
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    activeSkillsContext: agent.activeSkillsContext,
    bootstrapContext: agent.bootstrapContext,
    commMessage,
    toolSearchDeferredStats: deferredStats,
    platformSections: platformMarkdown,
  });

  return appendQuoteContextSystemHint(
    `${richPrompt}${preData ? `\n\nPre-fetched data:\n${preData}` : ''}`,
    commMessage as import('@zhin.js/core').AgentTurnMessage,
  );
}

export function buildFastPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  preData: string | undefined,
  commMessage: Message,
): string {
  return appendQuoteContextSystemHint(
    buildDisciplinedPrompt(agent, buildPreExecFastPathPrompt(personaEnhanced, preData ?? '')),
    commMessage as import('@zhin.js/core').AgentTurnMessage,
  );
}

export function buildChatPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  commMessage: Message,
): string {
  return appendQuoteContextSystemHint(
    buildDisciplinedPrompt(agent, personaEnhanced),
    commMessage as import('@zhin.js/core').AgentTurnMessage,
  );
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
  return appendQuoteContextSystemHint(
    buildLiteSystemPromptWithPlatform(
      personaEnhanced,
      platformMarkdown,
      formatSessionContextLine(commMessage) ?? undefined,
    ),
    commMessage as import('@zhin.js/core').AgentTurnMessage,
  );
}

export function buildAgentUserMessage(
  historyMessages: AgentMessage[],
  content: string,
): string {
  return buildUserMessageWithHistory(historyMessages, content);
}
