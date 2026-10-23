/**
 * What the bot says in a chat when a turn failed.
 *
 * A group member does not explain its outages: it says it lagged and asks again. Members get only
 * that line; the owner (master), who runs the bot, also gets a short cause in brackets. The full
 * error stays in the logs, and non-chat origins keep the precise operator messages.
 */
import { providerFailureKind, type FinishFailureKind, type ProviderErrorKind } from '@zhin.js/ai';

export type ChatFailureKind =
  | ProviderErrorKind
  | FinishFailureKind
  /** The reply could not be put into the message format. */
  | 'format'
  /** The whole turn timed out. */
  | 'turn_timeout'
  /** Any other turn error; `detail` carries its message for the owner. */
  | 'turn_error';

const TRANSIENT_LINES = ['刚卡了一下，你再说一遍？', '脑子短路了一下，再问我一次', '刚走神了，你再说一次'] as const;
const TIRED_LINES = ['今天先歇会儿，晚点再找我', '有点累了，晚点再聊'] as const;
const CONFUSED_LINES = ['这段聊太长了我有点乱，换个说法？'] as const;
const REFUSE_LINES = ['这个我不接'] as const;

const LINES: Readonly<Record<ChatFailureKind, readonly string[]>> = {
  rate_limit: TRANSIENT_LINES, timeout: TRANSIENT_LINES, server: TRANSIENT_LINES, network: TRANSIENT_LINES,
  empty_response: TRANSIENT_LINES, malformed_tool_call: TRANSIENT_LINES, provider_error: TRANSIENT_LINES,
  length: TRANSIENT_LINES, bad_request: TRANSIENT_LINES, unknown: TRANSIENT_LINES, format: TRANSIENT_LINES,
  turn_timeout: TRANSIENT_LINES, turn_error: TRANSIENT_LINES,
  quota_exhausted: TIRED_LINES, billing: TIRED_LINES, auth: TIRED_LINES,
  context_overflow: CONFUSED_LINES,
  safety_block: REFUSE_LINES,
  aborted: [],
};

/** Short cause for the owner; never shown to other members. */
const OWNER_CAUSE: Readonly<Record<ChatFailureKind, string | undefined>> = {
  rate_limit: '模型限流', timeout: '模型超时', server: '模型服务不可用', network: '连不上模型服务',
  empty_response: '模型回了空', malformed_tool_call: '工具调用格式坏了', provider_error: '模型中途出错',
  length: '输出超长', bad_request: '模型拒绝了请求', unknown: '模型调用失败', format: '回复格式没对上',
  turn_timeout: '处理超时', turn_error: undefined,
  quota_exhausted: '模型额度用完了', billing: '模型账户欠费', auth: '模型 API 密钥有问题',
  context_overflow: '上下文超长', safety_block: '内容被模型拦截', aborted: undefined,
};

export interface ChatFailureOptions {
  /** The sender is the bot's owner: append the cause. */
  readonly master?: boolean;
  /** Error message for `turn_error`, shown to the owner only (clipped). */
  readonly detail?: string;
  /** 0 ≤ value < 1, for choosing a line; defaults to Math.random. */
  readonly random?: number;
}

/** The chat line for a failure; '' when the bot should say nothing (a cancelled request). */
export function chatFailureLine(kind: ChatFailureKind, options: ChatFailureOptions = {}): string {
  const lines = LINES[kind];
  if (lines.length === 0) return '';
  const line = lines[Math.floor((options.random ?? Math.random()) * lines.length)] ?? lines[0]!;
  if (!options.master) return line;
  const cause = kind === 'turn_error' ? clip(options.detail) : OWNER_CAUSE[kind];
  return cause ? `${line}（${cause}）` : line;
}

/** Kind of a user-safe failure message from the provider layer; `unknown` for anything else. */
export function chatFailureKindOf(errorMessage: string | undefined): ChatFailureKind {
  return providerFailureKind(errorMessage) ?? 'unknown';
}

function clip(detail: string | undefined): string | undefined {
  const text = detail?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
