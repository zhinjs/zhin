import type { RuntimeMode } from '@zhin.js/runtime';

export interface StartOptions {
  readonly once: boolean;
  readonly noWatch: boolean;
  readonly open: boolean;
  readonly environment: string;
  readonly mode: RuntimeMode;
  readonly daemon: boolean;
  readonly logFile?: string;
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
  { flags: '--no-watch', description: '关闭文件监听与热重载' },
  { flags: '--once', description: '完成一次启动后输出 JSON 快照并退出（适合 CI）' },
  { flags: '--open', description: '在终端（TTY）启动成功后用浏览器打开 Remote Console；也可设置 ZHIN_OPEN=1' },
  { flags: '-d, --daemon', description: '守护进程模式：写 pid 文件、日志重定向、崩溃自动重启' },
  { flags: '--log-file <path>', description: 'daemon 日志文件，默认 <项目根>/.zhin/runtime.log' },
]);

/** Help section listing {@link START_OPTION_HELP}, aligned like Commander's own option list. */
export function formatStartOptionHelp(): string {
  const flagColumnWidth = Math.max(...START_OPTION_HELP.map((option) => option.flags.length)) + 2;
  const lines = START_OPTION_HELP.map((option) => `  ${option.flags.padEnd(flagColumnWidth)}${option.description}`);
  return ['', 'Start options:', ...lines, '', 'Examples:',
    '  zhin runtime start                               开发模式，改代码自动热重载',
    '  zhin runtime start --mode production --no-watch  生产模式，由 systemd / Docker 管理进程',
    '  zhin runtime start --once --mode test            CI 中检查配置与装配'].join('\n');
}

export function parseStartOptions(args: readonly string[]): StartOptions {
  let once = false;
  let noWatch = false;
  let openConsole = false;
  let environment = 'development';
  let environmentExplicit = false;
  let mode: RuntimeMode = 'development';
  let daemon = false;
  let logFile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--once') once = true;
    else if (argument === '--no-watch') noWatch = true;
    else if (argument === '--open') openConsole = true;
    else if (argument === '--daemon' || argument === '-d') daemon = true;
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
  if (!environmentExplicit) environment = mode;
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(environment)) {
    throw new Error(`Invalid environment name: ${environment || '<empty>'}`);
  }
  return Object.freeze({ once, noWatch, open: openConsole, environment, mode, daemon, logFile });
}

function parseMode(value: string | undefined): RuntimeMode {
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error(`Invalid Runtime mode: ${value || '<empty>'}`);
}
