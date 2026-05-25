import { MessageCommand, Time, usePlugin } from "zhin.js";

const plugin = usePlugin();
const { addCommand } = plugin;

function runtimeLabel(): string {
  if (typeof Deno !== "undefined") return `Deno ${Deno.version.deno}`;
  const g = globalThis as { navigator?: { userAgent?: string } };
  return g.navigator?.userAgent?.includes("Cloudflare") ? "cloudflare-workers" : "vercel-edge";
}

function processUptimeMs(): number {
  try {
    const proc = (globalThis as { process?: { uptime?: () => number } }).process;
    const sec = proc?.uptime?.();
    return typeof sec === "number" && Number.isFinite(sec) ? sec * 1000 : 0;
  } catch {
    return 0;
  }
}

function formatStatus(): string {
  return [
    `runtime: ${runtimeLabel()} · zhin.js`,
    `uptime: ${Time.formatTime(processUptimeMs())}`,
    `plugins: ${plugin.root.children.length}`,
  ].join("\n");
}

addCommand(
  new MessageCommand("help")
    .desc("帮助")
    .action(() =>
      [
        "Zhin.js Vercel Edge Playground",
        "",
        "命令: help · ping · zt · status",
        "AI: 私聊直聊，或 # / AI: 前缀（需 OPENAI_API_KEY）",
      ].join("\n"),
    ),
);

addCommand(
  new MessageCommand("ping").action(() => `pong · ${new Date().toISOString()}`),
);

addCommand(new MessageCommand("zt").desc("系统状态").action(() => formatStatus()));
addCommand(new MessageCommand("status").desc("系统状态").action(() => formatStatus()));
