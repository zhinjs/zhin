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
import type { AgentContextHost, ZhinAgentPrivate } from '../internal/agent-host.js';
import { getLlmTransportModel, type AgentMessage } from '@zhin.js/ai';
import { assembleSchedulePrompt } from '../schedule-domain/prompt-assembler.js';
import type { AgentPromptProfile } from './turn-prompt-profile.js';
import type { TurnContextView } from '../context/turn-envelope.js';

function promptPlatform(turn: TurnContextView): string | undefined {
  return turn.origin.kind === 'im' ? turn.origin.platform : undefined;
}

function scheduleSystemPrompt(
  agent: ZhinAgentPrivate,
  profile: Extract<AgentPromptProfile, { kind: 'schedule' }>,
  platformContext?: string,
): string {
  return assembleSchedulePrompt({
    jobId: profile.jobId,
    prompt: profile.prompt,
    createdBy: profile.createdBy,
    security: profile.security,
    platformContext,
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
    turn: TurnContextView;
    content: string;
    sessionId: string;
    deferredStats?: string;
    modelSdk?: string;
    runtime?: PromptRuntimeOverrides;
  },
): Promise<PromptSectionDebugInfo[]> {
  const platform = promptPlatform(options.turn);
  const platformMarkdown = platform ? await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      platform,
      userMessagePreview: options.content.slice(0, 500),
      deferred: options.deferredStats
        ? { goal: options.content, domainStats: options.deferredStats }
        : undefined,
    },
    config: agent.config,
    sessionId: options.sessionId,
  }) : '';

  return describePromptSectionsForDebug({
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    registry: agent.promptAssemblyRegistry,
    activeSkillsContext: options.runtime?.activeSkillsContext ?? agent.getTurnActiveSkills(),
    bootstrapContext: options.runtime?.bootstrapContext ?? agent.bootstrapContext,
    globalContext: agent.globalContext,
    turn: options.turn,
    gitStatus: agent.config.gitStatus
      ? (await getGitStatusLine(process.cwd())) ?? undefined
      : undefined,
    toolSearchDeferredStats: options.deferredStats,
    platformSections: platformMarkdown,
    orchestratorSdk: options.modelSdk,
    agentNickname: options.runtime?.agentNickname ?? agent.activeBinding?.nickname,
  });
}

export async function buildAgentPathSystemPrompt(
  agent: ZhinAgentPrivate,
  options: {
    profile: AgentPromptProfile;
    turn: TurnContextView;
    content: string;
    sessionId: string;
    personaEnhanced: string;
    preData?: string;
    deferredStats?: string;
    modelSdk?: string;
    runtime?: PromptRuntimeOverrides;
  },
): Promise<string> {
  const { content, sessionId, personaEnhanced, preData, deferredStats, modelSdk } = options;

  if (options.profile.kind === 'schedule') {
    return scheduleSystemPrompt(agent, options.profile);
  }
  const platform = promptPlatform(options.turn);
  const platformMarkdown = platform ? await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      platform,
      userMessagePreview: content.slice(0, 500),
      deferred: deferredStats ? { goal: content, domainStats: deferredStats } : undefined,
    },
    config: agent.config,
    sessionId,
  }) : '';

  const gitStatus = agent.config.gitStatus
    ? await getGitStatusLine(process.cwd())
    : null;

  const bindingModel = options.runtime?.modelId ?? agent.activeBinding?.model;
  const providerAlias = options.runtime?.providerAlias
    ?? agent.activeBinding?.providerAlias
    ?? agent.getTurnProvider().name;
  const llmModel = bindingModel
    ? getLlmTransportModel(providerAlias, bindingModel)
    : undefined;

  const promptCtx = {
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    registry: agent.promptAssemblyRegistry,
    activeSkillsContext: options.runtime?.activeSkillsContext ?? agent.getTurnActiveSkills(),
    bootstrapContext: options.runtime?.bootstrapContext ?? agent.bootstrapContext,
    globalContext: agent.globalContext,
    turn: options.turn,
    gitStatus: gitStatus ?? undefined,
    toolSearchDeferredStats: deferredStats,
    platformSections: platformMarkdown,
    orchestratorSdk: modelSdk,
    agentNickname: options.runtime?.agentNickname ?? agent.activeBinding?.nickname,
    modelId: bindingModel,
    contextWindow: llmModel?.contextWindow ?? agent.config.contextTokens,
  };
  const richPrompt = buildRichSystemPrompt(promptCtx);

  return `${richPrompt}${preData ? `\n\nPre-fetched data:\n${preData}` : ''}`;
}

export interface PromptRuntimeOverrides {
  readonly bootstrapContext?: string;
  readonly activeSkillsContext?: string;
  readonly agentNickname?: string;
  readonly modelId?: string;
  readonly providerAlias?: string;
}

export function buildChatPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  profile: AgentPromptProfile,
): string {
  if (profile.kind === 'schedule') return scheduleSystemPrompt(agent, profile);
  return buildDisciplinedPrompt(agent, personaEnhanced);
}

export async function buildMultimodalVisionSystemPrompt(
  agent: ZhinAgentPrivate,
  options: {
    turn: TurnContextView;
    sessionId: string;
    textContent: string;
    personaEnhanced: string;
  },
): Promise<string> {
  const { turn, sessionId, textContent, personaEnhanced } = options;
  const platform = promptPlatform(turn);
  const platformMarkdown = platform ? await resolveAgentPromptMarkdown({
    ctx: {
      slot: 'orchestrator',
      platform,
      userMessagePreview: textContent.slice(0, 500),
    },
    config: agent.config,
    sessionId,
  }) : '';
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
