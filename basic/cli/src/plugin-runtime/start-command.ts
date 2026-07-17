import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { YamlConfigDocument } from '@zhin.js/config-yaml';
import {
  supportsNativeTypeScript,
  type ConfigDocumentPort,
  type RuntimeConfigDocument,
  type RuntimeMode,
} from '@zhin.js/runtime';
import { RootHost } from './root-host.js';

export const processRestartExitCode = 75;

export interface StartCommandOptions {
  readonly root: string;
  readonly args: readonly string[];
  writeOutput(value: string): void;
  writeError(value: string): void;
}

export async function runStartCommand(options: StartCommandOptions): Promise<void> {
  if (await relaunchWithNativeTypeScript()) return;
  const parsed = parseStartOptions(options.args);
  const config = await loadProjectConfig(options.root);
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  const control: { stop(): Promise<void> } = {
    stop: async () => { throw new Error('RootHost stop is not bound'); },
  };
  const host = new RootHost({
    projectRoot: options.root,
    config,
    watch: !parsed.once && !parsed.noWatch,
    environment: {
      name: parsed.environment,
      mode: parsed.mode,
      platform: 'node',
    },
    async onRestartRequired(plan) {
      options.writeError(`${JSON.stringify({ restartRequired: plan }, null, 2)}\n`);
      process.exitCode = processRestartExitCode;
      await control.stop();
    },
    onError(error) {
      options.writeError(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    },
  });
  control.stop = async () => {
    await host.stop();
    complete();
  };

  const snapshot = await host.start();
  options.writeOutput(`${JSON.stringify({ started: true, ...snapshot }, null, 2)}\n`);
  if (parsed.once) {
    await control.stop();
    return;
  }

  const onSignal = (): void => { void control.stop(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try { await completed; }
  finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

async function relaunchWithNativeTypeScript(): Promise<boolean> {
  if (supportsNativeTypeScript()) return false;
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 6)) {
    throw new Error(
      `zhin runtime start requires Node >=22.6.0 for native TypeScript; found ${process.versions.node}`,
    );
  }
  const entry = process.argv[1];
  if (!entry) throw new Error('Cannot determine the zhin runtime executable path');
  const child = spawn(process.execPath, [
    '--experimental-strip-types',
    entry,
    ...process.argv.slice(2),
  ], { stdio: 'inherit' });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );
  if (result.signal) {
    throw new Error(`Native TypeScript child exited from ${result.signal}`);
  }
  process.exitCode = result.code ?? 1;
  return true;
}

interface StartOptions {
  readonly once: boolean;
  readonly noWatch: boolean;
  readonly environment: string;
  readonly mode: RuntimeMode;
}

function parseStartOptions(args: readonly string[]): StartOptions {
  let once = false;
  let noWatch = false;
  let environment = 'development';
  let mode: RuntimeMode = 'development';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--once') once = true;
    else if (argument === '--no-watch') noWatch = true;
    else if (argument === '--environment') {
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
  return { once, noWatch, environment, mode };
}

function parseMode(value: string | undefined): RuntimeMode {
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error(`Invalid Runtime mode: ${value || '<empty>'}`);
}

async function loadProjectConfig(
  root: string,
): Promise<RuntimeConfigDocument | ConfigDocumentPort> {
  const candidates = [
    'config.yml', 'config.yaml', 'config.json', 'zhin.config.yml', 'zhin.config.yaml',
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    const file = join(root, candidate);
    try { await access(file); existing.push(file); }
    catch { /* Missing candidates are expected. */ }
  }
  if (existing.length > 1) {
    throw new Error(`Multiple Root config files found: ${existing.join(', ')}`);
  }
  const file = existing[0];
  if (!file) return Object.freeze({});
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return new YamlConfigDocument(file);
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} must contain an object`);
  }
  return Object.freeze(value as RuntimeConfigDocument);
}
