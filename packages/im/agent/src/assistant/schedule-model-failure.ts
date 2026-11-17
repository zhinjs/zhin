/**
 * #1250 b40 schedule-failed-run-marked-ok / empty-reply-fallback-misleading: a schedule run whose
 * model request failed is retried later when the model service was only temporarily unavailable,
 * and its recipient is told which job did not run and what happens next (not "check your network",
 * which they cannot do).
 */
import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import type { ScheduleModelFailure } from '../schedule-domain/model-failure.js';

/** Delays of the automatic retries after a transient model failure: about 5, then 10 minutes. */
export const SCHEDULE_MODEL_RETRY_DELAYS_MS: readonly number[] = Object.freeze([5 * 60_000, 10 * 60_000]);

const messages = createMessages({
  service: { 'zh-CN': '模型服务（{name}）', en: 'the model service ({name})' },
  serviceUnnamed: { 'zh-CN': '模型服务', en: 'the model service' },
  network: { 'zh-CN': '暂时连不上', en: 'is temporarily unreachable' },
  server: { 'zh-CN': '暂时不可用', en: 'is temporarily unavailable' },
  timeout: { 'zh-CN': '响应超时', en: 'timed out' },
  other: { 'zh-CN': '调用失败（{kind}）', en: 'failed ({kind})' },
  willRetry: {
    'zh-CN': '『{label}』这次没生成：{service}{problem}，{minutes} 分钟后会自动重试。',
    en: '"{label}" was not generated this time: {service} {problem}; it will retry automatically in {minutes} minutes.',
  },
  gaveUp: {
    'zh-CN': '『{label}』这次没生成：{service}{problem}，已自动重试 {retries} 次，不再重试。排查：zhin trace {turn}',
    en: '"{label}" was not generated this time: {service} {problem}; retried automatically {retries} time(s), no further retries. To investigate: zhin trace {turn}',
  },
  noRetry: {
    'zh-CN': '『{label}』这次没生成：{service}{problem}，不会自动重试。排查：zhin trace {turn}',
    en: '"{label}" was not generated this time: {service} {problem}; it will not be retried automatically. To investigate: zhin trace {turn}',
  },
});

function problem(locale: Locale | undefined, kind: string): string {
  if (kind === 'network' || kind === 'server') return messages(locale, kind);
  if (kind === 'timeout' || kind === 'no_response') return messages(locale, 'timeout');
  return messages(locale, 'other', { kind });
}

/**
 * The recipient's notice for a schedule run that failed on its model request. `retryInMs`: the next
 * automatic retry; otherwise `retries` says how many were already made (0: none will be made).
 */
export function scheduleModelFailureNotice(locale: Locale | undefined, input: Readonly<{
  label: string;
  failure: ScheduleModelFailure;
  turnId: string;
  retryInMs?: number;
  retries: number;
}>): string {
  const service = input.failure.service?.trim()
    ? messages(locale, 'service', { name: input.failure.service.trim() })
    : messages(locale, 'serviceUnnamed');
  const common = { label: input.label, service, problem: problem(locale, input.failure.kind) };
  if (input.retryInMs !== undefined) {
    return messages(locale, 'willRetry', { ...common, minutes: Math.max(1, Math.round(input.retryInMs / 60_000)) });
  }
  return input.retries > 0
    ? messages(locale, 'gaveUp', { ...common, retries: input.retries, turn: input.turnId })
    : messages(locale, 'noRetry', { ...common, turn: input.turnId });
}
