/**
 * `session_event_create`（ADR 0037 §2，切片 D）：模型只能为**当前会话**建日程事件。
 *
 * - `risk: 'safe'`：只写一行 `ai_session_events`（`status=scheduled`、`created_via=model`）。
 *   不接受 `platform` / `scene_id` 参数：目标永远是当前回合的群 / 频道；私聊或非 IM 回合直接报错。
 * - 修改 / 取消（包括他人建的事件）只经 Console；模型没有改 / 取消工具。
 * - 到点提醒由宿主调度：控制面 → session-gate → 模板直发（默认不调模型）。
 * - 创建写 `kind=schedule`、`reason_code=schedule_event_created`、`actor=model` 审计（由存储写）。
 */
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import {
  MAX_SESSION_EVENT_REMIND_OFFSETS,
  MAX_SESSION_EVENT_TEMPLATE_CHARS,
  MAX_SESSION_EVENT_TITLE_CHARS,
  type AiSessionEvents,
} from '../session-events.js';

export const SESSION_EVENT_CREATE_TOOL_NAME = 'session_event_create';

export interface NativeSessionEventToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export type SessionEventStoreSource = () => AiSessionEvents | undefined;

/** 带时区偏移（`Z` / `+08:00` / `+0800`）的 ISO 8601；不带偏移的时间不猜时区。 */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/iu;

export function parseSessionEventAt(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && ISO_WITH_OFFSET.test(value.trim())) {
    const ms = Date.parse(value.trim());
    if (Number.isFinite(ms)) return ms;
  }
  throw new TypeError('at must be an ISO 8601 time with an explicit UTC offset (e.g. 2026-10-31T14:30:00+08:00) or epoch milliseconds');
}

function remindBeforeOf(value: unknown): number[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('remind_before_minutes must be an array of minutes');
  if (value.length > MAX_SESSION_EVENT_REMIND_OFFSETS) {
    throw new TypeError(`remind_before_minutes accepts at most ${MAX_SESSION_EVENT_REMIND_OFFSETS} entries`);
  }
  return value.map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0) throw new TypeError('remind_before_minutes entries must be positive integers');
    return item * 60_000;
  });
}

export function createNativeSessionEventToolFeatures(source: SessionEventStoreSource): readonly NativeSessionEventToolFeature[] {
  return Object.freeze([
    Object.freeze({
      feature: toolFeatureId,
      name: SESSION_EVENT_CREATE_TOOL_NAME,
      definition: defineAgentTool<Record<string, unknown>, string>({
        description: 'Schedule an event for the CURRENT group/channel so the bot reminds the group before it and when it starts. '
          + 'Only works inside a group or channel conversation and always targets that conversation. '
          + 'The reminder is a fixed template message; it cannot be changed or cancelled from chat (operators use the Console).',
        inputSchema: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            title: Object.freeze({ type: 'string', description: 'Short event title.', maxLength: MAX_SESSION_EVENT_TITLE_CHARS }),
            at: Object.freeze({ type: 'string', description: 'Event start time as ISO 8601 with an explicit offset, e.g. 2026-10-31T14:30:00+08:00.' }),
            remind_before_minutes: Object.freeze({
              type: 'array',
              items: Object.freeze({ type: 'integer', minimum: 1 }),
              maxItems: MAX_SESSION_EVENT_REMIND_OFFSETS,
              description: 'Extra early reminders in minutes before the start, e.g. [1440, 60]. The start time itself is always reminded.',
            }),
            template: Object.freeze({
              type: 'string',
              maxLength: MAX_SESSION_EVENT_TEMPLATE_CHARS,
              description: 'Optional reminder text with {title} {at} {in}; omit to use the default template.',
            }),
          }),
          required: Object.freeze(['title', 'at']),
        }),
        requiresApproval: 'never',
        risk: 'safe',
        execute: async (input, context) => createSessionEvent(source, input, context),
      }) as Readonly<AgentToolDefinition<Record<string, unknown>, string>>,
    }),
  ]);
}

async function createSessionEvent(
  source: SessionEventStoreSource,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const store = source();
  if (!store) throw new Error('session events are unavailable');
  const origin = context.origin;
  const im = origin.kind === 'im' ? origin : undefined;
  if (!im || (im.scope !== 'group' && im.scope !== 'channel') || !im.sceneId) {
    throw new TypeError('session_event_create only works inside a group or channel conversation (current session only)');
  }
  const title = input.title;
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('title is required');
  const at = parseSessionEventAt(input.at);
  const remindBefore = remindBeforeOf(input.remind_before_minutes);
  if (input.template !== undefined && typeof input.template !== 'string') throw new TypeError('template must be text');
  const sceneId = `${im.scope}:${im.sceneId}`;
  const createdBy = context.principal?.subjectId?.trim() || 'model';
  const { record } = await store.create({
    platform: im.platform,
    sceneId,
    title,
    at,
    remindBefore,
    ...(typeof input.template === 'string' ? { template: input.template } : {}),
    createdBy,
    createdVia: 'model',
    endpoint: im.endpoint || null,
    turnId: context.turnId,
  });
  const reminders = [...record.remindBefore.map((ms) => `${Math.round(ms / 60_000)} min before`), 'at start'];
  return `Session event ${record.id} scheduled for ${im.platform} ${sceneId} at ${new Date(record.at).toISOString()} `
    + `(reminders: ${reminders.join(', ')}${record.fired.length ? `; already-past reminders skipped: ${record.fired.length}` : ''}). `
    + 'Reminders are sent automatically; only operators can change or cancel it in the Console.';
}
