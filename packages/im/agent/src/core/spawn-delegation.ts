/**
 * Detect whether spawn_task tool results mean "still running in background"
 * (async) vs "already finished in this turn" (wait=true / sync).
 *
 * Async-only turns intentionally suppress the main finalReply so auto-continue
 * can summarize later. Sync turns must keep the main reply for IM / schedule
 * delivery.
 */
export function toolResultToText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    if (Array.isArray(record.content)) {
      return record.content
        .map((block) => {
          if (typeof block === 'string') return block;
          if (block && typeof block === 'object' && typeof (block as { text?: string }).text === 'string') {
            return (block as { text: string }).text;
          }
          return '';
        })
        .join('\n');
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/** spawn_task wait=true：工具结果含「同步等待」。 */
export function isSyncCompletedSpawnTaskResult(result: unknown): boolean {
  return toolResultToText(result).includes('同步等待');
}

/** spawn_task 默认异步：已启动、等待后台完成。 */
export function isAsyncPendingSpawnTaskResult(result: unknown): boolean {
  const text = toolResultToText(result);
  if (text.includes('同步等待')) return false;
  return /已启动/.test(text);
}

/**
 * True when the main turn should leave finalReply empty so auto-continue
 * delivers later. Sync wait=true spawns already returned results in-tool —
 * keep the main agent reply for IM / schedule delivery.
 */
export function shouldSuppressReplyForSpawnDelegation(
  toolCalls: ReadonlyArray<{ tool: string; result?: unknown }>,
): boolean {
  const spawnCalls = toolCalls.filter((tc) => tc.tool === 'spawn_task');
  if (spawnCalls.length === 0) return false;
  if (spawnCalls.some((tc) => isSyncCompletedSpawnTaskResult(tc.result))) return false;
  return true;
}
