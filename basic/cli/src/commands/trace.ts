/**
 * `zhin trace <turnId|last>` — print a recent Agent turn trace from
 * data/agent-traces/recent.json, written by the running bot.
 */
import { Command } from 'commander';

interface TraceCommandOptions {
  readonly json?: boolean;
  readonly list?: boolean;
  readonly timeline?: boolean;
  readonly cwd?: string;
}

export const traceCommand = new Command('trace')
  .description('查看最近 Agent 回合的 trace（模型调用、工具调用、失败步骤、结束原因）')
  .argument('[turn]', '回合 id（可只写前缀），或 last 表示最近一次', 'last')
  .option('-l, --list', '列出最近记录的回合')
  .option('--json', '输出原始 JSON')
  .option('--no-timeline', '不打印时间线')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .action(async (turn: string, options: TraceCommandOptions) => {
    let mod: typeof import('@zhin.js/agent/trace');
    try {
      mod = await import('@zhin.js/agent/trace');
    } catch {
      console.error('需要安装 @zhin.js/agent（AI 栈）。运行: pnpm add @zhin.js/agent');
      process.exitCode = 1;
      return;
    }
    const file = mod.defaultTurnTraceFile(options.cwd ?? process.cwd());
    const store = mod.createFileTurnTraceStore(file);

    if (options.list) {
      const traces = await store.list();
      console.log(options.json ? JSON.stringify(traces, null, 2) : mod.formatTurnTraceList(traces));
      return;
    }

    const trace = turn === 'last' ? await store.latest() : await store.find(turn);
    if (!trace) {
      console.error(turn === 'last'
        ? `还没有 trace 记录（${file}）。机器人处理过一次 AI 对话后再试。`
        : `找不到回合 ${turn}。用 zhin trace --list 查看最近的回合。`);
      process.exitCode = 1;
      return;
    }
    console.log(options.json
      ? JSON.stringify(trace, null, 2)
      : mod.formatTurnTrace(trace, { timeline: options.timeline !== false }));
  });
