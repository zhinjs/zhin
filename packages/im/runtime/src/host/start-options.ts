import type { RuntimeMode } from '../environment.js';

export type RuntimeWatchScope = 'source' | 'config';

export interface StartOptions {
  readonly once: boolean;
  readonly noWatch: boolean;
  readonly watch: readonly RuntimeWatchScope[];
  readonly open: boolean;
  readonly environment: string;
  readonly mode: RuntimeMode;
  readonly daemon: boolean;
  readonly logFile?: string;
  /**
   * Development / test only: run the instance in this process with its own Node HTTP server
   * instead of under the gateway (ADR 0054 §3). No supervised restarts.
   */
  readonly standalone: boolean;
}

/** One `zhin runtime start` option as shown in `--help`; parsing stays in {@link parseStartOptions}. */
export interface StartOptionHelp {
  readonly flags: string;
  readonly description: string;
}

/**
 * Options accepted by {@link parseStartOptions}. `zhin runtime start` parses its arguments itself
 * (they are forwarded to the supervised child process), so Commander does not know them; this list
 * is what `--help` prints. Keep it in sync with the parser (covered by tests).
 */
export const START_OPTION_HELP: readonly StartOptionHelp[] = Object.freeze([
  { flags: '--mode <mode>', description: '运行模式：development（默认）/ test / production' },
  { flags: '--environment <name>', description: '环境名，决定加载 .env.<name>；默认与 --mode 相同' },
  { flags: '--watch <scope...>', description: '显式监听 source / config；默认不监听，可组合为 --watch source config' },
  { flags: '--no-watch', description: '不监听（兼容入口，与 --watch 不能同时使用）' },
  { flags: '--once', description: '完成一次启动后输出 JSON 快照并退出（适合 CI）' },
  { flags: '--open', description: '在终端（TTY）启动成功后用浏览器打开 Remote Console；也可设置 ZHIN_OPEN=1' },
  { flags: '-d, --daemon', description: '守护进程模式：写 pid 文件、日志重定向、崩溃自动重启' },
  { flags: '--log-file <path>', description: 'daemon 日志文件，默认 <项目根>/.zhin/logs/instance.log（按大小轮转）' },
  { flags: '--standalone', description: '仅开发 / 测试：不经网关，实例在本进程内自带 HTTP 服务器（无受管重启）' },
]);

/** Help section listing {@link START_OPTION_HELP}, aligned like Commander's own option list. */
export function formatStartOptionHelp(): string {
  const flagColumnWidth = Math.max(...START_OPTION_HELP.map((option) => option.flags.length)) + 2;
  const lines = START_OPTION_HELP.map((option) => `  ${option.flags.padEnd(flagColumnWidth)}${option.description}`);
  return ['', 'Start options:', ...lines, '', 'Examples:',
    '  zhin runtime start --watch source config          同时监听源码和配置',
    '  zhin runtime start --watch config                 仅监听配置',
    '  zhin runtime start --mode production              不监听，由 systemd / Docker 管理进程',
    '  zhin runtime start --once --mode test            CI 中检查配置与装配'].join('\n');
}

export function parseStartOptions(args: readonly string[]): StartOptions {
  let once = false;
  let noWatch = false;
  const watch = new Set<RuntimeWatchScope>();
  let openConsole = false;
  let environment = 'development';
  let environmentExplicit = false;
  let mode: RuntimeMode = 'development';
  let daemon = false;
  let logFile: string | undefined;
  let standalone = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--once') once = true;
    else if (argument === '--no-watch') noWatch = true;
    else if (argument === '--watch') {
      let count = 0;
      while (index + 1 < args.length && !args[index + 1]!.startsWith('-')) {
        const scope = args[++index];
        if (scope !== 'source' && scope !== 'config') throw new Error(`Invalid watch scope: ${String(scope)}`);
        watch.add(scope);
        count += 1;
      }
      if (count === 0) throw new Error('--watch requires source or config');
    }
    else if (argument === '--open') openConsole = true;
    else if (argument === '--daemon' || argument === '-d') daemon = true;
    else if (argument === '--standalone') standalone = true;
    else if (argument === '--log-file') {
      logFile = args[index + 1] ?? '';
      index += 1;
    } else if (argument?.startsWith('--log-file=')) {
      logFile = argument.slice('--log-file='.length);
    } else if (argument === '--environment') {
      environment = args[index + 1] ?? '';
      environmentExplicit = true;
      index += 1;
    } else if (argument?.startsWith('--environment=')) {
      environment = argument.slice('--environment='.length);
      environmentExplicit = true;
    } else if (argument === '--mode') {
      mode = parseMode(args[index + 1]);
      index += 1;
    } else if (argument?.startsWith('--mode=')) {
      mode = parseMode(argument.slice('--mode='.length));
    } else {
      throw new Error(`Unknown start option: ${String(argument)}`);
    }
  }
  if (noWatch && watch.size > 0) throw new Error('--watch cannot be combined with --no-watch');
  if (!environmentExplicit) environment = mode;
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(environment)) {
    throw new Error(`Invalid environment name: ${environment || '<empty>'}`);
  }
  return Object.freeze({ once, noWatch: watch.size === 0, watch: Object.freeze([...watch]),
    open: openConsole, environment, mode, daemon, logFile, standalone });
}

function parseMode(value: string | undefined): RuntimeMode {
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error(`Invalid Runtime mode: ${value || '<empty>'}`);
}
