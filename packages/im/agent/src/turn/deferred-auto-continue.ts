/**
 * Deferred worker 完成后自动唤醒主 Agent 续聊（方案 B）。
 */
import { createUserMessage, type UserMessage } from '@zhin.js/ai';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { resolveSubagentDisplayLabel } from '../subagent-goal-notify.js';
import { extractDeferredBody } from './deferred-delivery.js';
import type { ZhinAgentConfig } from '../config/index.js';

export const DEFERRED_AUTO_CONTINUE_MARKER = '[Deferred worker 完成 — 自动续聊]';

const FALSE_ENV = new Set(['0', 'false', 'off', 'no']);
const TRUE_ENV = new Set(['1', 'true', 'on', 'yes']);

export function isDeferredAutoContinueEnabled(
  config: Required<ZhinAgentConfig>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.ZHIN_DEFERRED_AUTO_CONTINUE?.trim().toLowerCase();
  if (raw && FALSE_ENV.has(raw)) return false;
  if (raw && TRUE_ENV.has(raw)) return true;
  return config.deferredAutoContinue;
}

export function shouldDeferredAutoContinue(
  config: Required<ZhinAgentConfig>,
  result: DeferredWorkerResult,
  depth: number,
  persisted: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isDeferredAutoContinueEnabled(config, env)) return false;
  if (!persisted) return false;
  if (result.status === 'error') return false;
  if (depth >= config.deferredAutoContinueMaxDepth) return false;
  return extractDeferredBody(result).trim().length > 0;
}

export function buildDeferredAutoContinueUserMessage(
  taskId: string,
  goal: string,
  status: DeferredWorkerResult['status'],
): UserMessage {
  const label = resolveSubagentDisplayLabel(undefined, goal);
  const text = [
    DEFERRED_AUTO_CONTINUE_MARKER,
    `任务【${taskId}】· ${label}`,
    `Worker 状态：${status}。`,
    '请根据上下文中 `[Deferred worker 完成]` 的 Worker 输出继续推进任务（含答题、提交、后续 API 调用）；无需等待用户输入。',
    '若任务已全部完成，向用户简要汇报结果；否则继续调用工具（含 run_deferred_task）执行下一步。',
    '不要向用户重复粘贴 Worker 的完整原始输出。',
  ].join('\n');
  return createUserMessage(text);
}
