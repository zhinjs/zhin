/**
 * Runs one scenario as the production IM chat turn sees it: the workspace bootstrap files through
 * the chat-turn system prompt, the turn context envelope, pending conversation events and the
 * structured reply contract. Tools, skills and memory recall are not part of the evaluated turn.
 */
import {
  assistantAnswerText,
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
  buildTurnContextEnvelope,
  type TurnContextView,
} from '../../../packages/im/agent/src/context/turn-envelope.js';
import { applyTurnContextToUserMessages } from '../../../packages/im/agent/src/context/turn-user-message.js';
import {
  decodeStructuredReply,
  structuredReplyInstruction,
  structuredReplySchema,
} from '../../../packages/im/agent/src/outbound/structured-reply.js';
import { decodeLenientStructuredReply } from '../../../packages/im/agent/src/core/structured-reply-recovery.js';
import type { AgentOutputElement } from '../../../packages/im/agent/src/outbound/agent-output.js';
import type { Scenario } from './scenario.js';

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

export async function buildSystemPrompt(workspaceDir: string, nickname: string | undefined, turn: TurnContextView): Promise<string> {
  const bootstrapContext = buildStableBootstrapSection(await loadBootstrapFiles(workspaceDir));
  const prompt = buildRichSystemPrompt({
    config: DEFAULT_CONFIG,
    skillRegistry: null,
    skillsSummaryXML: '',
    activeSkillsContext: '',
    bootstrapContext,
    turn,
    ...(nickname ? { agentNickname: nickname } : {}),
  });
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

/** The envelope always stamps the current time; scenarios that depend on the hour pin it. */
function withScenarioTime(envelope: string | null, time: string | undefined): string | null {
  if (!envelope || !time) return envelope;
  return envelope.replace(/^Time: .*$/m, `Time: ${time}`);
}

export function buildUserMessages(scenario: Scenario): UserMessage[] {
  const envelope = withScenarioTime(buildTurnContextEnvelope({ turn: scenarioTurn(scenario) }), scenario.time);
  const context = scenario.context.length > 0
    ? renderContextMessage({
        role: 'user-context',
        blocks: scenario.context.map(text => ({
          type: 'untrusted_conversation_event', eventType: 'message.created', text, source: 'external_content',
        })),
      })
    : '';
  const current = applyTurnContextToUserMessages([createUserMessage(scenario.message)], envelope);
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
      messages: buildUserMessages(input.scenario),
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
