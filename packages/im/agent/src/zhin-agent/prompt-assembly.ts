import type { ToolContext } from '../orchestrator/types.js';
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
import type { ChatMessage } from '@zhin.js/ai';

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
    context: ToolContext;
    sessionId: string;
    personaEnhanced: string;
    preData?: string;
    deferredStats?: string;
  },
): Promise<string> {
  const { content, context, sessionId, personaEnhanced, preData, deferredStats } = options;

  const platformMarkdown = await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      toolContext: context,
      toolSearch: !!agent.config.toolSearch,
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
    toolContext: context,
    toolSearchDeferredStats: deferredStats,
    platformSections: platformMarkdown,
  });

  return appendQuoteContextSystemHint(
    `${richPrompt}${preData ? `\n\nPre-fetched data:\n${preData}` : ''}`,
    context,
  );
}

export function buildFastPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  preData: string | undefined,
  context: ToolContext,
): string {
  return appendQuoteContextSystemHint(
    buildDisciplinedPrompt(agent, buildPreExecFastPathPrompt(personaEnhanced, preData ?? '')),
    context,
  );
}

export function buildChatPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  context: ToolContext,
): string {
  return appendQuoteContextSystemHint(
    buildDisciplinedPrompt(agent, personaEnhanced),
    context,
  );
}

export async function buildMultimodalVisionSystemPrompt(
  agent: ZhinAgentPrivate,
  options: {
    context: ToolContext;
    sessionId: string;
    textContent: string;
    personaEnhanced: string;
  },
): Promise<string> {
  const { context, sessionId, textContent, personaEnhanced } = options;
  const platformMarkdown = await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      toolContext: context,
      toolSearch: !!agent.config.toolSearch,
      userMessagePreview: textContent.slice(0, 500),
    },
    config: agent.config,
    sessionId,
  });
  return appendQuoteContextSystemHint(
    buildLiteSystemPromptWithPlatform(
      personaEnhanced,
      platformMarkdown,
      formatSessionContextLine(context) ?? undefined,
    ),
    context,
  );
}

export function buildAgentUserMessage(
  historyMessages: ChatMessage[],
  content: string,
): string {
  return buildUserMessageWithHistory(historyMessages, content);
}
