/**
 * Per-key warn-once registry for optional peer / fallback messages.
 * key 通常为 peer id（如 `speech`、`html-renderer`）。
 */
const warnedKeys = new Set<string>();

export function createWarnOnce(key: string): (warn: ((message: string) => void) | undefined, message: string) => void {
  return (warn, message) => {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    warn?.(message);
  };
}

/** 测试用：重置全部或指定 key */
export function resetWarnOnceForTests(key?: string): void {
  if (key) {
    warnedKeys.delete(key);
    return;
  }
  warnedKeys.clear();
}
