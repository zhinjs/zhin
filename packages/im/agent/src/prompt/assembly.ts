import {
  buildRichSystemPrompt,
  buildLiteSystemPrompt,
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
import { PromptAssemblyRegistry } from './prompt-assembly-registry.js';
import { DEFAULT_CONFIG } from '../config/index.js';

function scheduleSystemPrompt(
  agent: ZhinAgentPrivate,
  profile: Extract<AgentPromptProfile, { kind: 'schedule' }>,
  platformContext?: string,
  registry?: import('./prompt-assembly-registry.js').PromptAssemblyRegistry,
): string {
  const base = assembleSchedulePrompt({
    jobId: profile.jobId,
    prompt: profile.prompt,
    createdBy: profile.createdBy,
    security: profile.security,
    platformContext,
    skillContext: agent.getTurnActiveSkills(),
    bootstrapContext: [agent.globalContext, agent.bootstrapContext].filter(Boolean).join('\n\n'),
  }).systemPrompt;
  return mergeRequiredBasePrompt(
    base,
    'Schedule Runtime',
    agent.config?.systemPromptMaxChars ?? DEFAULT_CONFIG.systemPromptMaxChars,
    registry,
  );
}

function mergeRequiredBasePrompt(
  base: string,
  title: string,
  maxChars: number,
  registry?: PromptAssemblyRegistry,
): string {
  const assembly = new PromptAssemblyRegistry();
  assembly.register('§runtime_base', {
    layer: 'system',
    title,
    content: base,
    order: Number.MAX_SAFE_INTEGER,
    retention: 'required',
  });
  if (registry) assembly.merge(registry);
  return assembly.build(maxChars);
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
  return describePromptSectionsForDebug({
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    registry: options.runtime?.registry,
    activeSkillsContext: options.runtime?.activeSkillsContext ?? agent.getTurnActiveSkills(),
    bootstrapContext: options.runtime?.bootstrapContext ?? agent.bootstrapContext,
    globalContext: agent.globalContext,
    turn: options.turn,
    gitStatus: agent.config.gitStatus
      ? (await getGitStatusLine(process.cwd())) ?? undefined
      : undefined,
    toolSearchDeferredStats: options.deferredStats,
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
  const { preData, deferredStats, modelSdk } = options;

  if (options.profile.kind === 'schedule') {
    return scheduleSystemPrompt(agent, options.profile, undefined, options.runtime?.registry);
  }
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
    registry: options.runtime?.registry,
    activeSkillsContext: options.runtime?.activeSkillsContext ?? agent.getTurnActiveSkills(),
    bootstrapContext: options.runtime?.bootstrapContext ?? agent.bootstrapContext,
    globalContext: agent.globalContext,
    turn: options.turn,
    gitStatus: gitStatus ?? undefined,
    toolSearchDeferredStats: deferredStats,
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
  readonly registry?: import('./prompt-assembly-registry.js').PromptAssemblyRegistry;
}

export function buildChatPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  profile: AgentPromptProfile,
  runtime?: PromptRuntimeOverrides,
): string {
  if (profile.kind === 'schedule') return scheduleSystemPrompt(agent, profile, undefined, runtime?.registry);
  return mergeRequiredBasePrompt(
    buildDisciplinedPrompt(agent, personaEnhanced),
    'Agent Runtime',
    agent.config?.systemPromptMaxChars ?? DEFAULT_CONFIG.systemPromptMaxChars,
    runtime?.registry,
  );
}

export async function buildMultimodalVisionSystemPrompt(
  agent: ZhinAgentPrivate,
  options: {
    turn: TurnContextView;
    sessionId: string;
    textContent: string;
    personaEnhanced: string;
    runtime?: PromptRuntimeOverrides;
  },
): Promise<string> {
  return mergeRequiredBasePrompt(
    buildLiteSystemPrompt(options.personaEnhanced),
    'Vision Runtime',
    agent.config?.systemPromptMaxChars ?? DEFAULT_CONFIG.systemPromptMaxChars,
    options.runtime?.registry,
  );
}

export function buildAgentUserMessage(
  historyMessages: AgentMessage[],
  content: string,
): string {
  return buildUserMessageWithHistory(historyMessages, content);
}
