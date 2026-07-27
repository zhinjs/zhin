/**
 * Telegram long-polling loop for getUpdates.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { TelegramUpdate } from './protocol.js';

const logger = getLogger('telegram');
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const DEFAULT_POLL_TIMEOUT_SEC = 30;

export interface TelegramPollingHost {
  readonly allowedUpdates: readonly string[];
  callApi<T>(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T>;
  getUpdateOffset(): number;
  setUpdateOffset(offset: number): void;
  handleUpdate(update: TelegramUpdate): void;
}

export async function runTelegramPollLoop(
  host: TelegramPollingHost,
  abortSignal: AbortSignal,
): Promise<void> {
  let consecutiveFailures = 0;
  while (!abortSignal.aborted) {
    try {
      const updates = await host.callApi<TelegramUpdate[]>('getUpdates', {
        offset: host.getUpdateOffset() || undefined,
        timeout: DEFAULT_POLL_TIMEOUT_SEC,
        allowed_updates: host.allowedUpdates,
      }, abortSignal);
      consecutiveFailures = 0;
      for (const update of updates) {
        host.setUpdateOffset(update.update_id + 1);
        host.handleUpdate(update);
      }
    } catch (err) {
      if (abortSignal.aborted) return;
      consecutiveFailures += 1;
      logger.error(formatCompact({
        op: 'poll',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      // 不在退避后清零：对端持续挂时清零会让重试固定打满 RETRY_DELAY_MS，
      // 保持计数才能让 BACKOFF_DELAY_MS 持续生效（成功时上面才清零）。
      await sleep(
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS,
        abortSignal,
      );
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
