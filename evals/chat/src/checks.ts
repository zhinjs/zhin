/** Deterministic checks: what a human group member never sends, whatever the persona. */
import type { Scenario } from './scenario.js';
import type { TurnResult } from './turn.js';

export interface CheckResult {
  readonly id: string;
  readonly ok: boolean;
  /** `fail` counts against the scenario; `warn` is reported only. */
  readonly severity: 'fail' | 'warn';
  readonly detail?: string;
}

/** Service-desk and assistant phrasing; the chat persona forbids all of it. */
export const ASSISTANT_PHRASES = [
  '作为AI', '作为一个AI', '作为人工智能', '我是AI助手', '我是一个AI', '我只是一个AI',
  '很高兴为你服务', '很高兴为您服务', '希望对你有帮助', '希望对您有帮助', '希望能帮到你',
  '有什么可以帮你', '有什么可以帮您', '有事喊我', '随时叫我', '随时找我', '老板有什么吩咐',
  '如有其他问题', '还有什么需要',
] as const;

/** Internals the bot must not talk about in chat. */
export const INTERNAL_TERMS = ['提示词', '系统提示', 'system prompt', '限流', 'API 密钥', 'API密钥', 'token 不足'] as const;

const PLACEHOLDERS = /\[(?:图片|表情|语音|视频|动画表情|image|sticker)\]/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const TRAILING_TILDE = /[～~]\s*$/u;
/** A short parenthesised stage direction such as （笑） or (摊手). */
const STAGE_DIRECTION = /[（(][^）)\n]{1,6}[）)]/u;

export function runChecks(scenario: Scenario, result: TurnResult): CheckResult[] {
  if (result.callError) return [{ id: 'call', ok: false, severity: 'fail', detail: result.callError }];
  const checks: CheckResult[] = [];
  const add = (id: string, ok: boolean, detail?: string, severity: 'fail' | 'warn' = 'fail') => {
    checks.push({ id, ok, severity, ...(ok || !detail ? {} : { detail }) });
  };
  add('format', !result.formatError, result.formatError);

  const silent = result.messages.length === 0;
  if (scenario.expect.silent === true) add('silent', silent, `replied: ${result.messages.join(' / ')}`);
  if (scenario.expect.silent === false) add('replied', !silent, 'stayed quiet');
  if (silent) return checks;

  const text = result.messages.join('\n');
  const maxMessages = scenario.expect.maxMessages ?? 3;
  add('message_count', result.messages.length <= maxMessages, `${result.messages.length} messages > ${maxMessages}`);
  if (scenario.expect.maxChars !== undefined) {
    const chars = [...text.replace(/\s/g, '')].length;
    add('length', chars <= scenario.expect.maxChars, `${chars} chars > ${scenario.expect.maxChars}`);
  }

  const assistant = ASSISTANT_PHRASES.filter(phrase => text.includes(phrase));
  add('assistant_tone', assistant.length === 0, assistant.join(', '));
  const internal = INTERNAL_TERMS.filter(term => text.toLowerCase().includes(term.toLowerCase()));
  add('internals', internal.length === 0, internal.join(', '));
  const forbidden = (scenario.expect.forbid ?? []).filter(phrase => text.includes(phrase));
  add('forbidden', forbidden.length === 0, forbidden.join(', '));
  add('placeholder', !PLACEHOLDERS.test(text), text.match(PLACEHOLDERS)?.[0]);
  add('emoji', !EMOJI.test(text), text.match(EMOJI)?.[0]);
  add('tilde', !result.messages.some(message => TRAILING_TILDE.test(message)), 'ends with ～');
  add('stage_direction', !STAGE_DIRECTION.test(text), text.match(STAGE_DIRECTION)?.[0], 'warn');

  if (scenario.expect.mustMention?.length) {
    add('must_mention', scenario.expect.mustMention.some(term => text.includes(term)), `none of ${scenario.expect.mustMention.join(', ')}`);
  }
  if (scenario.expect.segment) {
    add('segment', result.segmentTypes.some(types => types.includes(scenario.expect.segment!)), `no ${scenario.expect.segment} segment`);
  }
  return checks;
}
