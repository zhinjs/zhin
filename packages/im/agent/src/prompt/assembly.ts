import {
  buildRichSystemPromptParts,
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
import { PromptSegmentRegistry, type SystemPromptParts } from './segments/registry.js';
import { SECTION_SEP } from '../config/zhin-agent-constants.js';
import type { PromptSegment } from './segments/types.js';
import { DEFAULT_CONFIG } from '../config/index.js';

/**
 * System prompt split at the provider cache breakpoint (ADR 0042 §1): `stable` is byte-identical
 * across sessions and scenes for one instance and model; `scene` holds everything turn-specific.
 */
export interface SystemPromptSplit {
  readonly stable: string;
  readonly scene: string;
}

/** Appends to the stable prefix (instance/provider-level text only). */
export function appendStable(parts: SystemPromptSplit, text: string): SystemPromptSplit {
  const stable = parts.stable ? `${parts.stable}${SECTION_SEP}${text}` : text;
  return { stable, scene: parts.scene };
}

/** Appends to the scene tail (anything that varies by turn, session, scene or sender). */
export function appendScene(parts: SystemPromptSplit, text: string): SystemPromptSplit {
  return { stable: parts.stable, scene: parts.scene ? `${parts.scene}${SECTION_SEP}${text}` : text };
}

/** Full prompt text plus the offset where the scene tail starts (`undefined` when no split). */
export function joinSystemPrompt(parts: SystemPromptSplit): { text: string; cacheBreakpoint?: number } {
  if (!parts.stable || !parts.scene) return { text: parts.stable || parts.scene };
  return { text: `${parts.stable}${SECTION_SEP}${parts.scene}`, cacheBreakpoint: parts.stable.length + SECTION_SEP.length };
}

function toSplit(parts: SystemPromptParts): SystemPromptSplit {
  return { stable: parts.stable, scene: parts.scene };
}

function scheduleSystemPrompt(
  agent: ZhinAgentPrivate,
  profile: Extract<AgentPromptProfile, { kind: 'schedule' }>,
  platformContext?: string,
  runtime?: PromptRuntimeOverrides,
): SystemPromptSplit {
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
    runtime,
  );
}

/** The rendered base is one required `system` segment; plugin segments and the scene line follow. */
function mergeRequiredBasePrompt(
  base: string,
  _title: string,
  maxChars: number,
  runtime?: PromptRuntimeOverrides,
): SystemPromptSplit {
  const assembly = new PromptSegmentRegistry();
  assembly.register({
    id: '§runtime_base',
    kind: 'system',
    weight: Number.MAX_SAFE_INTEGER,
    retention: 'required',
    inject: () => base,
  });
  if (runtime?.registry) assembly.registerAll(runtime.registry.toSegments());
  if (runtime?.segments) assembly.registerAll(runtime.segments);
  if (runtime?.sceneText?.trim()) {
    const sceneText = runtime.sceneText;
    assembly.register({ id: '§0_scene', kind: 'scene', weight: 100, retention: 'preferred', inject: () => sceneText });
  }
  return toSplit(assembly.buildSystemPromptParts({ history: [], runtime: {}, session: { sessionKey: '' } }, maxChars));
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
    segments: options.runtime?.segments,
    sceneText: options.runtime?.sceneText,
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
  options: AgentPathPromptOptions,
): Promise<string> {
  return joinSystemPrompt(await buildAgentPathSystemPromptParts(agent, options)).text;
}

export interface AgentPathPromptOptions {
  profile: AgentPromptProfile;
  turn: TurnContextView;
  content: string;
  sessionId: string;
  personaEnhanced: string;
  preData?: string;
  deferredStats?: string;
  modelSdk?: string;
  runtime?: PromptRuntimeOverrides;
}

export async function buildAgentPathSystemPromptParts(
  agent: ZhinAgentPrivate,
  options: AgentPathPromptOptions,
): Promise<SystemPromptSplit> {
  const { preData } = options;

  if (options.profile.kind === 'schedule') {
    return scheduleSystemPrompt(agent, options.profile, undefined, options.runtime);
  }

  const rich = toSplit(buildRichSystemPromptParts(agentPathPromptContext(agent, options)));
  return preData ? appendScene(rich, `Pre-fetched data:\n${preData}`) : rich;
}

export interface PromptRuntimeOverrides {
  readonly bootstrapContext?: string;
  readonly activeSkillsContext?: string;
  readonly agentNickname?: string;
  readonly modelId?: string;
  readonly providerAlias?: string;
  readonly modelSdk?: string;
  /** @deprecated Use `segments`. */
  readonly registry?: import('./prompt-assembly-registry.js').PromptAssemblyRegistry;
  /** ADR 0041 plugin segments (text kinds). */
  readonly segments?: readonly PromptSegment[];
  /** ADR 0041 `scene` line; rendered after the cache breakpoint. */
  readonly sceneText?: string;
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
  return joinSystemPrompt(buildChatPathSystemPromptParts(agent, personaEnhanced, profile, runtime)).text;
}

export function buildChatPathSystemPromptParts(
  agent: ZhinAgentPrivate,
  personaEnhanced: string,
  profile: AgentPromptProfile,
  runtime?: PromptRuntimeOverrides,
): SystemPromptSplit {
  if (profile.kind === 'schedule') return scheduleSystemPrompt(agent, profile, undefined, runtime);
  return mergeRequiredBasePrompt(
    buildDisciplinedPrompt(agent, withStableRuntime(personaEnhanced, runtime)),
    'Agent Runtime',
    agent.config?.systemPromptMaxChars ?? DEFAULT_CONFIG.systemPromptMaxChars,
    runtime,
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
  return joinSystemPrompt(mergeRequiredBasePrompt(
    buildLiteSystemPrompt(withStableRuntime(options.personaEnhanced, options.runtime)),
    'Vision Runtime',
    agent.config?.systemPromptMaxChars ?? DEFAULT_CONFIG.systemPromptMaxChars,
    options.runtime,
  )).text;
}

export function buildAgentUserMessage(
  historyMessages: AgentMessage[],
  content: string,
): string {
  return buildUserMessageWithHistory(historyMessages, content);
}
