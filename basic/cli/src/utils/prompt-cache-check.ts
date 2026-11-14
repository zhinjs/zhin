/**
 * `zhin doctor` check for #1250 usage-cache-unsupported-hint: reads the trace archive
 * (`data/agent-traces/*.jsonl`) through `@zhin.js/gateway/usage` — never the IM layers —
 * and warns about services that look like they do not support or pass through prompt caching.
 */
import { join } from 'node:path';
import { PromptCacheProbe, scanTraces, type PromptCacheHint, type UsageProviderResolver } from '@zhin.js/gateway/usage';

/** Days of traces the check reads. */
export const PROMPT_CACHE_CHECK_DAYS = 7;

export interface PromptCacheCheckResult {
  readonly name: string;
  readonly status: 'ok' | 'warn';
  readonly message: string;
  readonly fix?: string;
}

export async function promptCacheHintsFor(
  root: string,
  options: Readonly<{ dir?: string; now?: number; resolveProvider?: UsageProviderResolver }> = {},
): Promise<{ hints: PromptCacheHint[]; calls: number }> {
  const dir = options.dir ?? join(root, 'data', 'agent-traces');
  const since = (options.now ?? Date.now()) - PROMPT_CACHE_CHECK_DAYS * 86_400_000;
  const probe = new PromptCacheProbe(options.resolveProvider ? { resolveProvider: options.resolveProvider } : {});
  let calls = 0;
  await scanTraces(dir, { since }, (trace) => {
    calls += Array.isArray(trace.model_calls) ? trace.model_calls.length : 0;
    probe.visit(trace);
  });
  return { hints: probe.hints(), calls };
}

/** Doctor rows: one per suspicious service, or nothing when there are no traces. */
export async function diagnosePromptCache(
  root: string,
  options: Readonly<{ dir?: string; now?: number; loadResolver?: () => Promise<UsageProviderResolver | undefined> }> = {},
): Promise<PromptCacheCheckResult[]> {
  let result: { hints: PromptCacheHint[]; calls: number };
  try {
    result = await promptCacheHintsFor(root, options);
    // Service names (and merging `services:` / `accounts:` ids) only when there is something to say.
    if (result.hints.length > 0 && options.loadResolver) {
      const resolveProvider = await options.loadResolver().catch(() => undefined);
      if (resolveProvider) result = await promptCacheHintsFor(root, { ...options, resolveProvider });
    }
  } catch {
    return [];
  }
  if (result.calls === 0) return [];
  if (result.hints.length === 0) {
    return [{ name: '提示缓存', status: 'ok', message: `最近 ${PROMPT_CACHE_CHECK_DAYS} 天的模型调用未发现缓存长期失效的服务` }];
  }
  return result.hints.map(hint => ({
    name: '提示缓存',
    status: 'warn' as const,
    message: hint.message,
    fix: '确认该服务（或中转）支持 prompt 缓存并透传缓存字段；不支持时可换用支持缓存的服务，zhin usage report 查看明细',
  }));
}
