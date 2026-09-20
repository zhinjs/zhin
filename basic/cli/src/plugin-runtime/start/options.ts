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

export function parseStartOptions(args: readonly string[]): StartOptions {
  let once = false;
  let noWatch = false;
  let openConsole = false;
  let environment = 'development';
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
      index += 1;
    } else if (argument?.startsWith('--environment=')) {
      environment = argument.slice('--environment='.length);
    } else if (argument === '--mode') {
      mode = parseMode(args[index + 1]);
      index += 1;
    } else if (argument?.startsWith('--mode=')) {
      mode = parseMode(argument.slice('--mode='.length));
    } else {
      throw new Error(`Unknown start option: ${String(argument)}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(environment)) {
    throw new Error(`Invalid environment name: ${environment || '<empty>'}`);
  }
  return Object.freeze({ once, noWatch, open: openConsole, environment, mode, daemon, logFile });
}

function parseMode(value: string | undefined): RuntimeMode {
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error(`Invalid Runtime mode: ${value || '<empty>'}`);
}
