import { randomUUID } from 'node:crypto';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
  type ToolQuestionAnswer,
  type ToolQuestionType,
} from '@zhin.js/tool';

export interface NativeInteractionToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export function createNativeInteractionToolFeatures(): readonly NativeInteractionToolFeature[] {
  return Object.freeze([Object.freeze({
    feature: toolFeatureId,
    name: 'ask_user',
    definition: defineAgentTool({
      description: 'Ask the authenticated user a text, number, confirmation, or multiple-choice question and wait for the canonical reply. Use confirm/pick instead of asking in prose when the user must approve or choose; supported IM adapters render native buttons.',
      inputSchema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          question: Object.freeze({ type: 'string' }),
          type: Object.freeze({ type: 'string', enum: Object.freeze(['text', 'number', 'confirm', 'pick']) }),
          options: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
          default_value: Object.freeze({ type: 'string' }),
          timeout: Object.freeze({ type: 'number', description: 'Timeout in seconds (1-300)' }),
        }),
        required: Object.freeze(['question']),
      }),
      approval: 'never',
      execute: askUser,
    }),
  })]);
}

async function askUser(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  if (!context.question) throw new Error('QuestionPort is unavailable for this Turn');
  const question = requiredText(input.question, 'question', 4_000);
  const type = questionType(input.type);
  const options = type === 'pick' ? questionOptions(input.options) : undefined;
  const timeoutSeconds = typeof input.timeout === 'number' && Number.isFinite(input.timeout)
    ? Math.max(1, Math.min(300, Math.floor(input.timeout)))
    : 120;
  const answer = await context.question.ask({
    requestId: `${context.turnId}:${randomUUID()}`,
    question,
    type,
    ...(options ? { options } : {}),
    ...(typeof input.default_value === 'string' ? { defaultValue: input.default_value } : {}),
    timeoutMs: timeoutSeconds * 1_000,
    signal: context.signal,
  });
  return formatAnswer(answer);
}

function questionType(value: unknown): ToolQuestionType {
  if (value === undefined) return 'text';
  if (value === 'text' || value === 'number' || value === 'confirm' || value === 'pick') return value;
  throw new TypeError('type must be text, number, confirm, or pick');
}

function questionOptions(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) {
    throw new TypeError('pick requires 2-20 options');
  }
  return Object.freeze(value.map((option, index) => requiredText(option, `options[${index}]`, 500)));
}

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  if (value.length > maximum) throw new TypeError(`${name} exceeds ${maximum} characters`);
  return value.trim();
}

function formatAnswer(answer: ToolQuestionAnswer): string {
  if (answer.type === 'confirm') return answer.value ? 'yes' : 'no';
  if (answer.type === 'number') return String(answer.value);
  return answer.value;
}
