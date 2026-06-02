/** 客户端提前关闭连接（SSE、轮询中断等）时的常见错误，不应打满日志。 */
export function isBenignClientDisconnect(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as NodeJS.ErrnoException;
  if (e.code === "ECONNRESET" || e.code === "ERR_STREAM_PREMATURE_CLOSE" || e.code === "EPIPE") {
    return true;
  }
  const msg = e.message ?? "";
  return msg.includes("Premature close") || msg.includes("aborted");
}
