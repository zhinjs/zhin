/**
 * What the bot says in a chat when a turn failed.
 *
 * A group member does not explain its outages: it says it lagged and asks again. Members get only
 * that line; the owner (master), who runs the bot, also gets a short cause in brackets. The full
 * error stays in the logs, and non-chat origins keep the precise operator messages.
 */
import { providerFailureKind, type FinishFailureKind, type ProviderErrorKind } from '@zhin.js/ai';
import { createMessages, type Locale } from '@zhin.js/plugin-runtime';

export type ChatFailureKind =
  | ProviderErrorKind
  | FinishFailureKind
  /** The reply could not be put into the message format. */
  | 'format'
  /** The whole turn timed out. */
  | 'turn_timeout'
  /** Any other turn error; `detail` carries its message for the owner. */
  | 'turn_error';

const messages = createMessages({
  transient1: { 'zh-CN': '刚卡了一下，你再说一遍？', en: 'I got stuck for a moment. Could you try again?' },
  transient2: { 'zh-CN': '脑子短路了一下，再问我一次', en: 'I lost my train of thought. Could you ask again?' },
  transient3: { 'zh-CN': '刚走神了，你再说一次', en: 'I missed that. Could you say it again?' },
  tired1: { 'zh-CN': '今天先歇会儿，晚点再找我', en: 'I need a break. Please try again later.' },
  tired2: { 'zh-CN': '有点累了，晚点再聊', en: 'I cannot continue right now. Let us try again later.' },
  confused: { 'zh-CN': '这段聊太长了我有点乱，换个说法？', en: 'This conversation has grown too long. Could you rephrase that?' },
  refuse: { 'zh-CN': '这个我不接', en: 'I cannot help with that.' },
  rate_limit: { 'zh-CN': '模型限流', en: 'Model rate limit' },
  timeout: { 'zh-CN': '模型超时', en: 'Model timeout' },
  server: { 'zh-CN': '模型服务不可用', en: 'Model service unavailable' },
  network: { 'zh-CN': '连不上模型服务', en: 'Cannot reach the model service' },
  empty_response: { 'zh-CN': '模型回了空', en: 'Empty model response' },
  malformed_tool_call: { 'zh-CN': '工具调用格式坏了', en: 'Malformed tool call' },
  provider_error: { 'zh-CN': '模型中途出错', en: 'Model stream failed' },
  length: { 'zh-CN': '输出超长', en: 'Output limit reached' },
  bad_request: { 'zh-CN': '模型拒绝了请求', en: 'Model rejected the request' },
  unknown: { 'zh-CN': '模型调用失败', en: 'Model request failed' },
  format: { 'zh-CN': '回复格式没对上', en: 'Invalid reply format' },
  turn_timeout: { 'zh-CN': '处理超时', en: 'Turn timeout' },
  quota_exhausted: { 'zh-CN': '模型额度用完了', en: 'Model quota exhausted' },
  billing: { 'zh-CN': '模型账户欠费', en: 'Model account billing issue' },
  auth: { 'zh-CN': '模型 API 密钥有问题', en: 'Model API credentials rejected' },
  context_overflow: { 'zh-CN': '上下文超长', en: 'Context limit exceeded' },
  safety_block: { 'zh-CN': '内容被模型拦截', en: 'Blocked by model safety policy' },
  withCause: { 'zh-CN': '{line}（{cause}）', en: '{line} ({cause})' },
});
type MessageKey = Parameters<typeof messages>[1];
const TRANSIENT_LINES = ['transient1', 'transient2', 'transient3'] as const;
const TIRED_LINES = ['tired1', 'tired2'] as const;
const CONFUSED_LINES = ['confused'] as const;
const REFUSE_LINES = ['refuse'] as const;

const LINES: Readonly<Record<ChatFailureKind, readonly MessageKey[]>> = {
  rate_limit: TRANSIENT_LINES, timeout: TRANSIENT_LINES, server: TRANSIENT_LINES, network: TRANSIENT_LINES,
  empty_response: TRANSIENT_LINES, malformed_tool_call: TRANSIENT_LINES, provider_error: TRANSIENT_LINES,
  length: TRANSIENT_LINES, bad_request: TRANSIENT_LINES, unknown: TRANSIENT_LINES, format: TRANSIENT_LINES,
  turn_timeout: TRANSIENT_LINES, turn_error: TRANSIENT_LINES,
  quota_exhausted: TIRED_LINES, billing: TIRED_LINES, auth: TIRED_LINES,
  context_overflow: CONFUSED_LINES,
  safety_block: REFUSE_LINES,
  aborted: [],
};

export interface ChatFailureOptions {
  readonly locale?: Locale;
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
  const line = messages(options.locale, lines[Math.floor((options.random ?? Math.random()) * lines.length)] ?? lines[0]!);
  if (!options.master) return line;
  const cause = kind === 'turn_error' ? clip(options.detail) : kind === 'aborted' ? undefined : messages(options.locale, kind);
  return cause ? messages(options.locale, 'withCause', { line, cause }) : line;
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
