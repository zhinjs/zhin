/**
 * Agent 工作区资源发现完成信号（技能 / 工作区工具异步加载）。
 */
let ready = false;
let resolveReady: (() => void) | null = null;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export function markAgentBootstrapReady(): void {
  if (ready) return;
  ready = true;
  resolveReady?.();
}

/** 等待技能等工作区资源发现；超时后仍继续（避免无 AI 时卡住） */
export async function waitForAgentBootstrap(timeoutMs = 3000): Promise<void> {
  if (ready) return;
  await Promise.race([
    readyPromise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** 测试重置 */
export function resetAgentBootstrapGateForTests(): void {
  ready = false;
}
