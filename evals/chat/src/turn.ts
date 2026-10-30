/**
 * Runs one scenario as the production IM chat turn sees it: the workspace bootstrap files through
 * the chat-turn system prompt, the turn context envelope, pending conversation events and the
 * structured reply contract. Tools, skills and memory recall are not part of the evaluated turn.
 */
import {
  assistantAnswerText,
  createLlmMessageProjection,
  createPromptContextBlock,
  createUserMessage,
  renderContextMessage,
  type LlmApiRuntime,
  type Model,
  type UserMessage,
} from '../../../packages/im/ai/src/index.js';
import { loadBootstrapFiles, buildStableBootstrapSection } from '../../../packages/im/agent/src/bootstrap.js';
import { DEFAULT_CONFIG } from '../../../packages/im/agent/src/config/index.js';
import { buildRichSystemPrompt } from '../../../packages/im/agent/src/prompt/system-prompt.js';
import {
  AMBIENT_ENGAGEMENT_METADATA_KEY,
  buildTurnContextBlocks,
  sceneLineForTurn,
  type TurnContextView,
} from '../../../packages/im/agent/src/context/turn-envelope.js';
import { appendRuntimeContext, appendTurnContextBlocks } from '../../../packages/im/agent/src/context/turn-user-message.js';
import { stampUserHeader } from '../../../packages/im/agent/src/session/participant-header-stamp.js';
import {
  decodeStructuredReply,
  structuredReplyInstruction,
  structuredReplySchema,
} from '../../../packages/im/agent/src/outbound/structured-reply.js';
import { decodeLenientStructuredReply } from '../../../packages/im/agent/src/core/structured-reply-recovery.js';
import type { AgentOutputElement } from '../../../packages/im/agent/src/outbound/agent-output.js';
import type { Scenario } from './scenario.js';
import { zonedTimeToUtc, getDatePartsInTimezone } from '../../../basic/schedule/src/utils/timezone.js';

export interface TurnResult {
  /** Text of each chat message the bot would send, in order. Empty when it chose to stay quiet. */
  readonly messages: readonly string[];
  /** Segment types per message, to check mentions, images, keyboards. */
  readonly segmentTypes: readonly (readonly string[])[];
  readonly raw: string;
  readonly formatError?: string;
  readonly callError?: string;
  readonly ms: number;
  readonly tokens: number;
}

export async function buildSystemPrompt(workspaceDir: string, nickname: string | undefined, turn: TurnContextView, time?: string): Promise<string> {
  const bootstrapContext = buildStableBootstrapSection(await loadBootstrapFiles(workspaceDir));
  const prompt = buildRichSystemPrompt({
    config: DEFAULT_CONFIG,
    skillRegistry: null,
    skillsSummaryXML: '',
    activeSkillsContext: '',
    bootstrapContext,
    turn,
    timeZone: scenarioTime(time).timeZone,
    ...(nickname ? { agentNickname: nickname } : {}),
  });
  // Same as production: the structured reply contract ends the system prompt; the scene line rides
  // in the current message's runtime-context tail (ADR 0045), see buildUserMessages.
  return `${prompt}\n\n${structuredReplyInstruction()}`;
}

export function scenarioTurn(scenario: Scenario): TurnContextView {
  return {
    origin: {
      kind: 'im', platform: 'icqq', endpoint: 'bot', scope: scenario.scope,
      sceneId: scenario.scope === 'group' ? '810001' : scenario.sender.id,
    },
    principal: {
      subjectId: scenario.sender.id,
      displayName: scenario.sender.name,
      roles: scenario.sender.master ? ['master'] : [],
    },
    session: { key: `eval:${scenario.id}` },
    input: {
      text: scenario.message,
      ...(scenario.addressed ? {} : { metadata: { [AMBIENT_ENGAGEMENT_METADATA_KEY]: 'ambient' } }),
    },
  } as TurnContextView;
}

/** Preserve the scenario wall clock as the production user's observedAt epoch. */
function scenarioTime(time: string | undefined): { observedAt: number; timeZone?: string } {
  if (!time) return { observedAt: Date.now() };
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \(([^()]+)\)$/.exec(time);
  if (!match?.[7]) throw new Error(`Invalid scenario.time: ${time}`);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const timezone = match[7];
  try {
    const date = zonedTimeToUtc(year, month, day, hour, minute, second, timezone);
    const parts = getDatePartsInTimezone(date, timezone);
    if (parts.year === year && parts.month === month && parts.day === day
      && parts.hour === hour && parts.minute === minute && parts.second === second) return { observedAt: date.getTime(), timeZone: timezone };
  } catch {
    // Invalid IANA zones and non-existent wall-clock dates are invalid fixtures.
  }
  throw new Error(`Invalid scenario.time: ${time}`);
}

/** Runtime timezone is stable per scenario; wall-clock changes do not invalidate system text. */
export function scenarioPromptKey(scenario: Scenario): string {
  return `${scenario.scope}:${scenario.addressed}:${scenarioTime(scenario.time).timeZone ?? 'host'}`;
}

export function buildUserMessages(scenario: Scenario): UserMessage[] {
  const turn = scenarioTurn(scenario);
  const { observedAt } = scenarioTime(scenario.time);
  const blocks = buildTurnContextBlocks({ turn, observedAt });
  const context = scenario.context.length > 0
    ? renderContextMessage({
        role: 'user-context',
        blocks: scenario.context.map(text => ({
          type: 'untrusted_conversation_event', eventType: 'message.created', text, source: 'external_content',
        })),
      })
    : '';
  const input = createUserMessage(scenario.message, undefined, observedAt, {
    subjectId: scenario.sender.id, displayName: scenario.sender.name, scope: scenario.scope,
    roles: turn.principal.roles, authorizationRoles: turn.principal.roles,
  });
  // The host stores only the actor; the projection renders the participant header (ADR 0041 §4, amended).
  const scene = sceneLineForTurn(turn);
  const current = appendRuntimeContext(appendTurnContextBlocks([stampUserHeader(input)], blocks),
    scene ? [createPromptContextBlock('scene', scene)] : []) as UserMessage[];
  return context ? [createUserMessage(context), ...current] : current;
}

export function outputMessages(output: readonly AgentOutputElement[]): { messages: string[]; segmentTypes: string[][] } {
  const messages: string[] = [];
  const segmentTypes: string[][] = [];
  for (const element of output) {
    if (element.type !== 'message') continue;
    segmentTypes.push(element.segments.map(segment => segment.type));
    messages.push(element.segments.map(segment => {
      const data = segment.data as Record<string, unknown>;
      if (segment.type === 'text') return String(data.text ?? '');
      if (segment.type === 'markdown') return String(data.content ?? '');
      if (segment.type === 'mention') return `@${String(data.target ?? '')}`;
      return `[${segment.type}]`;
    }).join(''));
  }
  return { messages, segmentTypes };
}

export async function runScenarioTurn(input: {
  readonly runtime: LlmApiRuntime;
  readonly model: Model;
  readonly systemPrompt: string;
  readonly scenario: Scenario;
}): Promise<TurnResult> {
  const started = Date.now();
  try {
    const assistant = await input.runtime.complete(input.model, {
      systemPrompt: input.systemPrompt,
      // Same LLM-boundary projection as production `convertToLlm` (headers, state changes).
      messages: createLlmMessageProjection(input.model)(buildUserMessages(input.scenario)),
      tools: undefined,
    }, { outputSchema: structuredReplySchema(), signal: AbortSignal.timeout(120_000) });
    const tokens = assistant.usage?.totalTokens ?? 0;
    if (assistant.errorMessage) {
      return { messages: [], segmentTypes: [], raw: '', callError: assistant.errorMessage, ms: Date.now() - started, tokens };
    }
    const raw = assistantAnswerText(assistant);
    // Same acceptance as production: strict first, then the lenient decoder before any correction call.
    let output: AgentOutputElement[];
    let formatError: string | undefined;
    try {
      output = decodeStructuredReply(raw);
    } catch (error) {
      const lenient = decodeLenientStructuredReply(raw);
      if (!lenient) {
        formatError = error instanceof Error ? error.message : String(error);
        output = [];
      } else {
        output = lenient.output;
      }
    }
    return { ...outputMessages(output), raw, ...(formatError ? { formatError } : {}), ms: Date.now() - started, tokens };
  } catch (error) {
    return { messages: [], segmentTypes: [], raw: '', callError: error instanceof Error ? error.message : String(error), ms: Date.now() - started, tokens: 0 };
  }
}
