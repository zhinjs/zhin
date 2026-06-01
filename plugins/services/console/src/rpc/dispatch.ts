import { usePlugin } from "zhin.js";
import type { ConsoleRpcContext, ConsoleWebServer, ProjectFs } from "./context.js";
import { createNodeProjectFs } from "./project-fs.js";
import { handleCoreRpc } from "./handlers-core.js";

export type DispatchConsoleRpcOptions = {
  root?: ReturnType<typeof usePlugin>;
  projectFs?: ProjectFs;
};

export function buildConsoleRpcContext(
  getWebServer: () => ConsoleWebServer,
  options: DispatchConsoleRpcOptions,
  emit: ConsoleRpcContext["emit"],
): ConsoleRpcContext {
  return {
    root: options.root ?? usePlugin(),
    webServer: getWebServer(),
    projectFs: options.projectFs ?? createNodeProjectFs(),
    emit,
  };
}

/** 收集 RPC 回复并返回与 REST 层兼容的单条 payload */
export function pickRpcReply(
  message: Record<string, unknown>,
  payloads: Record<string, unknown>[],
): Record<string, unknown> | null {
  const rid = message.requestId as number | undefined;
  return (
    (rid != null ? payloads.find((p) => p.requestId === rid) : undefined) ??
    payloads[payloads.length - 1] ??
    null
  );
}

/** Host：core + 回落 websocket 全量 handler。 */
export async function dispatchConsoleRpc(
  message: Record<string, unknown>,
  getWebServer: () => ConsoleWebServer,
  options: DispatchConsoleRpcOptions,
): Promise<Record<string, unknown>[]> {
  const payloads: Record<string, unknown>[] = [];
  const ctx = buildConsoleRpcContext(getWebServer, options, (p) => payloads.push(p));

  if (await handleCoreRpc(message, ctx)) {
    return payloads;
  }

  const { handleWebSocketMessage } = await import("../websocket.js");
  const fakeWs = {
    send(data: string) {
      try {
        payloads.push(JSON.parse(data) as Record<string, unknown>);
      } catch {
        payloads.push({ error: "invalid json response" });
      }
    },
    readyState: 1,
  };
  await handleWebSocketMessage(fakeWs as never, message, ctx.webServer as never, true);
  return payloads;
}
