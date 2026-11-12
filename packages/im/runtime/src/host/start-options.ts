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
  { flags: '-d, --daemon', description: '后台网关模式（zhin start 默认）：不回显实例输出、忽略 SIGHUP；实例日志写入 --log-file' },
  { flags: '--log-file <path>', description: '实例日志文件，默认 <项目根>/.zhin/logs/instance.log（按大小轮转；zhin logs 读取）' },
  { flags: '--standalone', description: '仅开发 / 测试：不经网关，实例在本进程内自带 HTTP 服务器（无受管重启）' },
]);

/** Which command prints the start options: their examples differ (ADR 0054 §6). */
export type StartHelpCommand = 'zhin start' | 'zhin runtime start';

/**
 * Help section listing {@link START_OPTION_HELP}, aligned like Commander's own option list.
 * `zhin start` runs in the background unless `-f, --foreground`, `--once` or `--standalone` is
 * given, so its examples spell `--foreground` out; it lists `-d, --daemon` under its own
 * gateway options. `zhin runtime start` is always the foreground alias.
 */
export function formatStartOptionHelp(command: StartHelpCommand = 'zhin runtime start'): string {
  const options = command === 'zhin start'
    ? START_OPTION_HELP.filter((option) => option.flags !== '-d, --daemon')
    : START_OPTION_HELP;
  const flagColumnWidth = Math.max(...options.map((option) => option.flags.length)) + 2;
  const lines = options.map((option) => `  ${option.flags.padEnd(flagColumnWidth)}${option.description}`);
  const examples = command === 'zhin start'
    ? [
      '  zhin start                                              后台运行网关与实例（zhin status / zhin logs -f / zhin stop）',
      '  zhin start --mode production --no-watch                 后台运行生产模式',
      '  zhin start --foreground --watch source config           前台开发：同时监听源码和配置，Ctrl+C 停止',
      '  zhin start --foreground --mode production --no-watch    前台运行，由 systemd / Docker / PM2 管理进程',
      '  zhin start --once --mode test                           CI 中检查配置与装配（--once / --standalone 总在前台）',
      '',
      '只有 -f / --foreground、--once、--standalone 在前台运行；其余（包括 --mode production）都在后台运行。',
    ]
    : [
      '  zhin runtime start --watch source config                同时监听源码和配置',
      '  zhin runtime start --watch config                       仅监听配置',
      '  zhin runtime start --mode production --no-watch         前台运行，由 systemd / Docker 管理进程',
      '  zhin runtime start --once --mode test                   CI 中检查配置与装配',
      '',
      'zhin runtime start 是 zhin start --foreground 的别名，总在前台运行。',
    ];
  return ['', 'Start options:', ...lines, '', 'Examples:', ...examples].join('\n');
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
