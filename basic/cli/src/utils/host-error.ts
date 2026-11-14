/**
 * Reports a failed instance API call (#1250).
 *
 * An expected failure (delivery refused, missing target, invalid argument) carries a classified
 * `code` and a user-facing explanation, shown as-is. An unexpected one carries only the generic
 * "Internal error" and a log correlation id: `--debug` shows the id and looks the matching line up
 * in the instance log (over the gateway, or from `.zhin/logs/instance.log`).
 */
import { existsSync } from 'node:fs';
import { CONSOLE_ERROR_ID_PATTERN, GATEWAY_RPC, type GatewayInstanceLogs } from '@zhin.js/console-protocol';
import { defaultInstanceLogFile } from '@zhin.js/gateway/supervisor';
import { isCliDebug } from './cli-flags.js';
import { probeGateway, readFileTail, withGateway } from './gateway.js';
import type { HostFetchResult } from './host-http.js';
import { logger } from './logger.js';

/**
 * Lines of the newest instance log (up to 1000) that mention `errorId`. The id comes from the
 * response body, so anything but a well-formed correlation id (`err_` + 12 hex) is not searched.
 */
export async function findInstanceLogLines(root: string, errorId: string): Promise<string[]> {
  if (!CONSOLE_ERROR_ID_PATTERN.test(errorId)) return [];
  const matches = (lines: readonly string[]) => lines.filter((line) => line.includes(errorId));
  try {
    if (await probeGateway({ root })) {
      const logs = await withGateway({ root }, (client) =>
        client.request<GatewayInstanceLogs>(GATEWAY_RPC.LOGS, { lines: 1000 }, { timeoutMs: 10_000 }));
      return matches(logs.lines.map((line) => line.line));
    }
    const file = defaultInstanceLogFile(root);
    return existsSync(file) ? matches(readFileTail(file, 1000)) : [];
  } catch {
    return [];
  }
}

/** Human-readable lines for a failed call (without the debug lookup). */
export function describeHostFailure(result: HostFetchResult<unknown>, fallback: string, debug = isCliDebug()): string[] {
  if (result.code === 'internal_error') {
    const lines = ['实例内部错误（Internal error）'];
    if (result.errorId) {
      lines.push(debug
        ? `日志关联 id: ${result.errorId}（在 zhin logs -n 1000 的输出中查找包含它的那一行）`
        : '加 --debug 查看日志关联 id，并据此在 zhin logs 中找到原因');
    } else {
      lines.push('原因见实例日志：zhin logs');
    }
    return lines;
  }
  const lines = [result.error || fallback];
  if (debug && result.code) {
    const detail = result.detail && typeof result.detail === 'object' ? result.detail as { code?: unknown; reason?: unknown } : undefined;
    const sub = typeof detail?.code === 'string' && detail.code !== result.code ? `，${detail.code}` : '';
    lines.push(`错误码: ${result.code}${sub}（HTTP ${result.status}）`);
  }
  return lines;
}

/** Logs a failed call (stderr); with `--debug` also prints the instance log line of an unexpected error. */
export async function reportHostFailure(result: HostFetchResult<unknown>, fallback: string, root = process.cwd()): Promise<void> {
  const debug = isCliDebug();
  const [first, ...rest] = describeHostFailure(result, fallback, debug);
  logger.error(first!);
  for (const line of rest) logger.info(`  ${line}`);
  if (debug && result.code === 'internal_error' && result.errorId) {
    const lines = await findInstanceLogLines(root, result.errorId);
    if (lines.length > 0) {
      logger.info('  实例日志:');
      for (const line of lines) logger.info(`    ${line}`);
    } else {
      logger.info('  最近 1000 行实例日志里没有找到这一行（可能已滚出，或实例未通过网关运行）');
    }
  }
}
