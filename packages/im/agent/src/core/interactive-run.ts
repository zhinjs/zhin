import type { UsageQuota, UsageSubject } from '../security/usage-quota.js';

/** Owned by one admitted interactive turn and shared only with its synchronous children. */
export interface InteractiveRun {
  check(): string | undefined;
  recordUsage(tokens: number): void;
}

export function createInteractiveRun(quota: UsageQuota, subject: UsageSubject, maxTokens: number): InteractiveRun {
  let used = 0;
  let stopped: string | undefined;
  return {
    check() {
      if (stopped) return stopped;
      const decision = quota.checkTokens(subject);
      if (!decision.allowed) stopped = decision.message;
      else if (maxTokens > 0 && used >= maxTokens) stopped = '本次任务已达到配置的 token 额度，任务尚未完成。';
      return stopped;
    },
    recordUsage(tokens) {
      used += tokens;
      quota.record(subject, tokens);
    },
  };
}
