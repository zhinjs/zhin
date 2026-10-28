import {
  buildRichSystemPrompt,
  buildLiteSystemPrompt,
  buildUserMessageWithHistory,
  FIXED_DISCIPLINE_RULES,
  fillPromptSlots,
  describePromptSectionsForDebug,
  buildStableRuntimeLines,
  type PromptSectionDebugInfo,
  type RichSystemPromptContext,
} from './system-prompt.js';
import { resolveWorkspacePrompt } from './workspace-prompt.js';
import type { AgentContextHost, ZhinAgentPrivate } from '../internal/agent-host.js';
import { type AgentMessage } from '@zhin.js/ai';
import { assembleSchedulePrompt } from '../schedule-domain/prompt-assembler.js';
import type { AgentPromptProfile } from './turn-prompt-profile.js';
import type { TurnContextView } from '../context/turn-envelope.js';
import { PromptAssemblyRegistry } from './prompt-assembly-registry.js';
import { DEFAULT_CONFIG } from '../config/index.js';

function scheduleSystemPrompt(
  agent: ZhinAgentPrivate,
  profile: Extract<AgentPromptProfile, { kind: 'schedule' }>,
  platformContext?: string,
  runtime?: PromptRuntimeOverrides,
): string {
  const base = assembleSchedulePrompt({
    jobId: profile.jobId,
    prompt: profile.prompt,
    createdBy: profile.createdBy,
    security: profile.security,
    platformContext,
    runtimeContext: buildStableRuntimeLines(runtime ?? {}).join('\n'),
    skillContext: agent.getTurnActiveSkills(),
    bootstrapContext: fillPromptSlots([agent.globalContext, agent.bootstrapContext].filter(Boolean).join('\n\n'), agent.activeBinding?.nickname),
  }).systemPrompt;
  return mergeRequiredBasePrompt(
    base,
    'Schedule Runtime',
    agent.config?.systemPromptMaxChars ?? DEFAULT_CONFIG.systemPromptMaxChars,
    runtime?.registry,
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
  return describePromptSectionsForDebug(agentPathPromptContext(agent, options));
}

function agentPathPromptContext(
  agent: ZhinAgentPrivate,
  options: {
    turn: TurnContextView;
    deferredStats?: string;
    modelSdk?: string;
    runtime?: PromptRuntimeOverrides;
  },
): RichSystemPromptContext {
  const bindingModel = options.runtime?.modelId ?? agent.activeBinding?.model;
  const providerAlias = options.runtime?.providerAlias
    ?? agent.activeBinding?.providerAlias
    ?? agent.getTurnProvider().name;
  const llmModel = bindingModel
    ? agent.llmRuntime.model(providerAlias, bindingModel)
    : undefined;
  return {
    config: agent.config,
    skillRegistry: agent.skillRegistry,
    skillsSummaryXML: agent.skillsSummaryXML,
    registry: options.runtime?.registry,
    activeSkillsContext: options.runtime?.activeSkillsContext ?? agent.getTurnActiveSkills(),
    bootstrapContext: options.runtime?.bootstrapContext ?? agent.bootstrapContext,
    globalContext: agent.globalContext,
    turn: options.turn,
    toolSearchDeferredStats: options.deferredStats,
    orchestratorSdk: options.modelSdk,
    agentNickname: options.runtime?.agentNickname ?? agent.activeBinding?.nickname,
    modelId: bindingModel,
    providerAlias,
    modelSdk: options.runtime?.modelSdk ?? options.modelSdk,
    contextWindow: llmModel?.contextWindow ?? agent.config.contextTokens,
  };
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
  const { preData } = options;

  if (options.profile.kind === 'schedule') {
    return scheduleSystemPrompt(agent, options.profile, undefined, options.runtime);
  }

  const richPrompt = buildRichSystemPrompt(agentPathPromptContext(agent, options));

  return `${richPrompt}${preData ? `\n\nPre-fetched data:\n${preData}` : ''}`;
}

export interface PromptRuntimeOverrides {
  readonly bootstrapContext?: string;
  readonly activeSkillsContext?: string;
  readonly agentNickname?: string;
  readonly modelId?: string;
  readonly providerAlias?: string;
  readonly modelSdk?: string;
  readonly registry?: import('./prompt-assembly-registry.js').PromptAssemblyRegistry;
}

function withStableRuntime(base: string, runtime?: PromptRuntimeOverrides): string {
  return `${base}\n\n# Runtime\n${buildStableRuntimeLines(runtime ?? {}).join('\n')}`;
}

export function buildChatPathSystemPrompt(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  profile: AgentPromptProfile,
  runtime?: PromptRuntimeOverrides,
): string {
  if (profile.kind === 'schedule') return scheduleSystemPrompt(agent, profile, undefined, runtime);
  return mergeRequiredBasePrompt(
    buildDisciplinedPrompt(agent, withStableRuntime(personaEnhanced, runtime)),
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
    buildLiteSystemPrompt(withStableRuntime(options.personaEnhanced, options.runtime)),
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
