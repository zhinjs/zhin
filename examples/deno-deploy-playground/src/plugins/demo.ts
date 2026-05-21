import { MessageCommand, Time, usePlugin } from "zhin.js";
import * as os from "node:os";
import process from "node:process";

const plugin = usePlugin();
const { addCommand } = plugin;

/** Deno 无 Deno.uptime()，用 Node 兼容的 process.uptime()（Deploy 运行时同样可用） */
function processUptimeMs(): number {
  const sec = process.uptime();
  return typeof sec === "number" && Number.isFinite(sec) ? sec * 1000 : 0;
}

function formatStatus(): string {
  const mem = Deno.memoryUsage();
  return [
    `runtime: Deno ${Deno.version.deno} · zhin.js`,
    `deploy: ${Deno.env.get("DENO_DEPLOYMENT_ID") ? "yes" : "local"}`,
    `region: ${Deno.env.get("DENO_REGION") ?? "n/a"}`,
    `os: ${os.platform()} ${os.arch()}`,
    `uptime: ${Time.formatTime(processUptimeMs())}`,
    `rss: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
    `plugins: ${plugin.root.children.length}`,
  ].join("\n");
}

addCommand(
  new MessageCommand("help")
    .desc("帮助")
    .action(() =>
      [
        "Zhin.js Deno Deploy Playground（真实运行时）",
        "",
        "命令: help · ping · zt · status",
        "AI: 私聊直聊，或 # / AI: 前缀（需 OPENAI_API_KEY）",
        "",
        "完整 IM 栈请本地: pnpm --filter test-bot dev",
      ].join("\n")
    ),
);

addCommand(
  new MessageCommand("ping").action(() => `pong · ${new Date().toISOString()}`),
);

addCommand(new MessageCommand("zt").desc("系统状态").action(() => formatStatus()));
addCommand(new MessageCommand("status").desc("系统状态").action(() => formatStatus()));
