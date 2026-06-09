/**
 * 从未知错误中提取消息字符串
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * 包装 RPC handler，统一错误处理
 * @param handler 实际处理函数
 * @param respond 发送响应的函数
 * @param label 操作描述（用于错误消息前缀）
 */
export function withRpcErrorHandling<T extends unknown[]>(
  handler: (...args: T) => Promise<void> | void,
  respond: (payload: Record<string, unknown>) => void,
  label: string,
) {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error: unknown) {
      respond({ error: `Failed to ${label}: ${getErrorMessage(error)}` });
    }
  };
}
