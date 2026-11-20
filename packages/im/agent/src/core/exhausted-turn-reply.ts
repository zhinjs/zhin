/**
 * Reply recovery for agent turns that end without visible assistant text,
 * typically because the loop hit `maxIterations` while the model was still
 * calling tools.
 *
 * Instead of dumping raw tool output to the user, run one extra completion
 * with tools disabled and ask the model to summarize its progress. If that
 * call fails, return a fixed message. Raw tool bodies never reach the user.
 */
import {
  assistantAnswerText,
  createUserMessage,
  type AgentMessage,
  type AssistantMessage,
  type LlmCompletionPort,
  type Model,
} from '@zhin.js/ai';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import type { Locale } from '@zhin.js/plugin-runtime';
import { turnReplyMessages } from './turn-reply-messages.js';
import { REPLY_LANGUAGE_RULE, formatReplyLanguageLine } from '../prompt/rules/reply-language.js';
import { omitInlineBinaryInAssistantMessages } from '../media/inline-binary.js';

const logger = getLogger('ZhinAgent:ExhaustedTurnReply');

/** Upper bound for the summary call, on top of the turn's own abort signal. */
export const EXHAUSTED_TURN_SUMMARY_TIMEOUT_MS = 30_000;

/** Shown when the summary call itself fails. Must never contain tool output. */
export const EXHAUSTED_TURN_FALLBACK_REPLY =
  turnReplyMessages('zh-CN', 'exhausted');

export function buildExhaustedTurnInstruction(maxIterations: number, locale?: Locale, localeSetByUser = false): string {
  const language = formatReplyLanguageLine(locale, localeSetByUser);
  return [
    `[System notice] You have used all ${maxIterations} tool-call steps for this turn, and tools are now disabled.`,
    REPLY_LANGUAGE_RULE,
    ...(language === undefined ? [] : [language]),
    'Reply to the user directly in a few short sentences:',
    '1. What you have done or found so far.',
    '2. What is still left to do.',
    '3. Ask whether they want you to continue.',
    'Do not paste file contents, search results, logs or other raw tool output. Do not attempt business tool calls. A supplied json response tool is still available to submit the final structured reply.',
  ].join('\n');
}

export interface ExhaustedTurnSummaryInput {
  readonly locale?: Locale;
  /** #1250 b69: `locale` is the sender's own `/language` setting rather than the project fallback. */
  readonly localeSetByUser?: boolean;
  readonly transport: LlmCompletionPort;
  readonly model: Model;
  readonly systemPrompt: string;
  /** Conversation as the model saw it: history, this turn's prompt and tool exchanges. */
  readonly messages: readonly AgentMessage[];
  readonly maxIterations: number;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly outputSchema?: Record<string, unknown>;
}

export interface ExhaustedTurnSummary {
  readonly reply: string;
  /** Present only when the model produced a usable summary; persisted so a later "继续" has context. */
  readonly assistant?: AssistantMessage;
}

export async function summarizeExhaustedTurn(
  input: ExhaustedTurnSummaryInput,
): Promise<ExhaustedTurnSummary> {
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? EXHAUSTED_TURN_SUMMARY_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;

  try {
    const assistant = await input.transport.complete(
      input.model,
      {
        systemPrompt: input.systemPrompt,
        messages: [
          // #1250 第 29 批：本轮助手原文里的内嵌媒体载荷不回送模型。
          ...omitInlineBinaryInAssistantMessages(input.messages),
          createUserMessage(buildExhaustedTurnInstruction(input.maxIterations, input.locale, input.localeSetByUser)),
        ],
        tools: undefined,
      },
      { signal, sessionId: input.sessionId, outputSchema: input.outputSchema },
    );

    const text = assistantAnswerText(assistant).trim();
    if (!text || assistant.errorMessage) {
      throw new Error(assistant.errorMessage ?? 'summary completion returned no text');
    }

    return {
      reply: text,
      assistant: { ...assistant, content: [{ type: 'text', text }] },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(formatCompact({ exhaustedTurnSummary: 'fail', error: truncatePreview(message) }));
    return { reply: turnReplyMessages(input.locale, 'exhausted') };
  }
}
