import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { YamlConfigDocument } from '@zhin.js/config-yaml';
import { ImRuntime } from '@zhin.js/core/runtime';
import { setLevel, getLogger, formatCompact, type LogLevelInput } from '@zhin.js/logger';
import {
  ConfigValidationError,
  supportsNativeTypeScript,
  type ConfigDocumentPort,
  type RuntimeConfigDocument,
  type RuntimeMode,
  ensureTypeScriptSpecifierRemap,
  expandEnvironmentValue,
} from '@zhin.js/runtime';
import { loadEnvFiles } from '../utils/env.js';
import { createConsoleHostModules, installConsoleHttp } from './console-host-installer.js';
import { installConsoleApi } from './console-api-installer.js';
import { installHttpHost, resolveHttpConfig } from './http-host-installer.js';
import { createDatabaseHost, installDatabaseHost, resolveDatabaseConfig } from './database-host-installer.js';
import { installOutboundHost } from './outbound-host-installer.js';
import { installScheduleHost } from './schedule-host-installer.js';
import { installAgentHost, resolveAiConfig, resolveAssistantConfigDocument, resolveCollaborationConfigDocument } from './agent-host-installer.js';
import { installSpeechHost, prepareSpeechHost, resolveSpeechConfig } from './speech-host-installer.js';
import { RootHost } from './root-host.js';

export const processRestartExitCode = 75;

/** Storm guard parity with the `zhin start` daemon: 10 restarts/minute, 3s delay. */
export const MAX_RESPAWNS_PER_MINUTE = 10;
export const RESPAWN_DELAY_MS = 3_000;
const RESPAWN_WINDOW_MS = 60_000;

export interface RespawnPlan {
  readonly respawn: boolean;
  readonly attempts: readonly number[];
}

/**
 * Pure backoff decision for native-TS child respawns.
 * `attempts` holds timestamps of respawns already scheduled; `once` mode never
 * respawns. Exit 75 (restartRequired) always respawns (subject to the storm
 * budget); in daemon mode any crash (non-zero exit / signal) also respawns.
 * Exceeding the per-minute budget stops respawning and the parent exits.
 */
export function planRespawn(
  exitCode: number | null,
  once: boolean,
  daemon: boolean,
  attempts: readonly number[],
  now = Date.now(),
): RespawnPlan {
  if (once) return Object.freeze({ respawn: false, attempts });
  const shouldRespawn = exitCode === processRestartExitCode
    || (daemon && exitCode !== 0);
  if (!shouldRespawn) return Object.freeze({ respawn: false, attempts });
  const recent = attempts.filter((timestamp) => now - timestamp < RESPAWN_WINDOW_MS);
  if (recent.length >= MAX_RESPAWNS_PER_MINUTE) {
    return Object.freeze({ respawn: false, attempts: recent });
  }
  return Object.freeze({ respawn: true, attempts: Object.freeze([...recent, now]) });
}

export interface StartCommandOptions {
  readonly root: string;
  readonly args: readonly string[];
  writeOutput(value: string): void;
  writeError(value: string): void;
}

export async function runStartCommand(options: StartCommandOptions): Promise<void> {
  // Parse before any relaunch so invalid options fail fast instead of looping.
  const parsed = parseStartOptions(options.args);
  if (await relaunchWithNativeTypeScript(parsed, options.root)) return;
  ensureTypeScriptSpecifierRemap();
  loadEnvFiles(options.root, parsed.environment);
  const { config, file: configFile } = await loadProjectConfig(options.root);
  await applyRuntimeLogLevel(config);
  const httpConfig = await resolveHttpConfig(config);
  const databaseConfig = await resolveDatabaseConfig(options.root, config);
  const aiConfig = await resolveAiConfig(config);
  const assistantConfig = await resolveAssistantConfigDocument(config);
  const collaborationConfig = await resolveCollaborationConfigDocument(config);
  const resolveEndpointOwner = await createEndpointOwnerResolver(config);
  const speechHandle = await prepareSpeechHost(await resolveSpeechConfig(config));
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  const control: { stop(): Promise<void> } = {
    stop: async () => { throw new Error('RootHost stop is not bound'); },
  };
  const im = new ImRuntime();
  const databaseHost = createDatabaseHost(databaseConfig);
  const consoleHost = createConsoleHostModules(options.root, !parsed.once && !parsed.noWatch);
  const host = new RootHost({
    projectRoot: options.root,
    config,
    modules: consoleHost.modules,
    watch: !parsed.once && !parsed.noWatch,
    environment: {
      name: parsed.environment,
      mode: parsed.mode,
      platform: 'node',
    },
    environmentVariables: {
      base: processEnvSource(),
    },
    installResources: async (context) => {
      im.install(context.resources);
      installHttpHost(httpConfig)(context);
      installDatabaseHost(databaseHost)(context);
      installOutboundHost(im)(context);
      installScheduleHost()(context);
      installSpeechHost(speechHandle)(context);
      // Agent Host seeds presets async — must await so unmatched handler
      // and dispose hooks are registered before generation commit.
      await installAgentHost({
        ai: aiConfig,
        assistant: assistantConfig,
        collaboration: collaborationConfig,
        im,
        projectRoot: options.root,
        resolveEndpointOwner,
        extraTools: speechHandle?.tools,
        transcribeUrl: speechHandle
          ? (url) => speechHandle.transcribeUrl(url)
          : undefined,
      })(context);
      installConsoleHttp({
        console: consoleHost.console,
        clientOutDir: consoleHost.clientOutDir,
      })(context);
      installConsoleApi({
        console: consoleHost.console,
        projectRoot: options.root,
        apiBase: httpConfig.apiBase,
        im,
        databaseHost,
        onRestart: () => {
          // Exit 51: CLI daemon (`zhin start` / `zhin dev`) auto-restarts the process.
          process.exit(51);
        },
      })(context);
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
  // Bind before start so Adapter definitions can resolve messageGatewayToken
  // while the first generation is still being prepared.
  im.attach(host.runtime.controller.snapshots);
  consoleHost.console.attach(host.runtime.controller.snapshots);
  control.stop = async () => {
    await host.stop();
    complete();
  };

  let snapshot: Awaited<ReturnType<typeof host.start>>;
  try {
    snapshot = await host.start();
  } catch (error) {
    // Annotate schema validation failures with the source config file name.
    if (configFile && error instanceof ConfigValidationError) {
      throw new ConfigValidationError(error.issues, configFile);
    }
    throw error;
  }
  options.writeOutput(`${JSON.stringify({ started: true, ...snapshot }, null, 2)}\n`);
  if (process.stdout.isTTY) {
    // 人可读启动总结；裸 JSON 保留给 stable-path 测试与脚本消费
    const endpoints = im.listEndpoints();
    const online = endpoints.filter((ep) => ep.status === 'online').map((ep) => ep.name);
    const offline = endpoints.filter((ep) => ep.status !== 'online').map((ep) => ep.name);
    const httpAddress = `${httpConfig.host ?? '127.0.0.1'}:${httpConfig.port ?? 8086}`;
    getLogger('startup').success(
      `zhin runtime started (plugins=${snapshot.plugins}, http=http://${httpAddress}, ` +
      `adapters online=[${online.join(', ')}] offline=[${offline.join(', ')}])`,
    );
  }
  if (parsed.once) {
    await control.stop();
    return;
  }

  // Orphan watchdog: if the supervising CLI wrapper died (kill -9, terminal
  // closed, wrapper crashed) this bot must not outlive it — a zombie keeps
  // platform connections alive and keeps watching project files.
  const orphanWatchdog = startOrphanWatchdog(() => { initiateShutdown(); });

  const onSignal = (): void => { initiateShutdown(); };
  // Force-exit backstop: stuck sockets (SSE /api/events, WS) or a wedged
  // Endpoint must not hang shutdown forever — whichever path initiates it.
  function initiateShutdown(): void {
    setTimeout(() => process.exit(0), 5_000).unref();
    void control.stop();
  }
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('SIGHUP', onSignal);
  try { await completed; }
  finally {
    clearInterval(orphanWatchdog);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
  }
}

/** Poll parent liveness; when the supervisor (or any parent) is gone, shut down. */
function startOrphanWatchdog(onOrphaned: () => void): NodeJS.Timeout {
  const supervisorPid = Number(process.env.ZHIN_SUPERVISOR_PID ?? '');
  const logger = getLogger('runtime');
  return setInterval(() => {
    if (Number.isInteger(supervisorPid) && supervisorPid > 0) {
      try {
        process.kill(supervisorPid, 0);
        return;
      } catch {
        // ESRCH — supervisor is gone
      }
    } else if (process.ppid && process.ppid !== 1) {
      return;
    }
    logger.error(formatCompact({
      op: 'orphan_shutdown',
      reason: Number.isInteger(supervisorPid) && supervisorPid > 0
        ? `supervisor ${supervisorPid} exited`
        : 'reparented to init (parent died)',
    }));
    onOrphaned();
  }, 2_000).unref();
}

function processEnvSource(): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    result[key] = value;
  }
  return Object.freeze(result);
}

async function relaunchWithNativeTypeScript(parsed: StartOptions, root: string): Promise<boolean> {
  // The respawned child runs in-process (marker env), so this wrapper only
  // runs once per supervisor.
  if (process.env.ZHIN_RUNTIME_CHILD) return false;
  if (supportsNativeTypeScript() && !parsed.daemon) return false;
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 6)) {
    throw new Error(
      `zhin runtime start requires Node >=22.6.0 for native TypeScript; found ${process.versions.node}`,
    );
  }
  const entry = process.argv[1];
  if (!entry) throw new Error('Cannot determine the zhin runtime executable path');

  // Daemon supervision: same contract as the legacy `zhin start --daemon` —
  // supervisor stays alive, writes .zhin.pid (so `zhin stop` works), logs to
  // file, respawns the bot on crash / exit 75 with storm-guard backoff.
  const daemon = parsed.daemon;
  const pidFile = join(root, '.zhin.pid');
  let stdio: 'inherit' | ['ignore', number, number] = 'inherit';
  if (daemon) {
    const logFile = parsed.logFile ?? join(root, '.zhin', 'runtime.log');
    await mkdir(dirname(logFile), { recursive: true });
    const fd = openSync(logFile, 'a');
    stdio = ['ignore', fd, fd];
    writeFileSync(pidFile, String(process.pid));
    getLogger('runtime').info(formatCompact({
      op: 'daemon_start', pid: process.pid, log: logFile,
      hint: `stop: zhin stop 或 kill -TERM ${process.pid}`,
    }));
  }
  const removePidFile = (): void => {
    if (!daemon) return;
    try {
      if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) rmSync(pidFile, { force: true });
    } catch { /* already gone */ }
  };

  // Exit 75 (restartRequired) has no supervisor here — consume it ourselves by
  // respawning the child with storm-guard backoff until the budget runs out.
  let attempts: readonly number[] = [];
  let interrupted = false;
  let activeChild: ChildProcess | undefined;
  const onSigint = (): void => {
    interrupted = true;
    activeChild?.kill('SIGINT');
  };
  // Forward the other terminal signals too, and never leave the child behind:
  // a bot whose wrapper died keeps platform connections (and file watchers)
  // alive as a zombie.
  const forward = (signal: NodeJS.Signals) => (): void => {
    interrupted = true;
    activeChild?.kill(signal);
  };
  const onSigterm = forward('SIGTERM');
  const onSighup = forward('SIGHUP');
  const onExit = (): void => {
    try { activeChild?.kill('SIGTERM'); } catch { /* already gone */ }
    removePidFile();
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  process.on('SIGHUP', onSighup);
  process.on('exit', onExit);
  try {
    for (;;) {
      const child = spawn(process.execPath, [
        '--experimental-strip-types',
        entry,
        ...process.argv.slice(2),
      ], {
        stdio,
        // Lets the child self-terminate if this wrapper dies without forwarding.
        env: {
          ...process.env,
          ZHIN_SUPERVISOR_PID: String(process.pid),
          ZHIN_RUNTIME_CHILD: '1',
        },
      });
      activeChild = child;
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => resolve({ code, signal }));
        },
      );
      activeChild = undefined;
      if (interrupted) {
        process.exitCode = result.code ?? 130;
        return true;
      }
      // Daemon treats any crash (signal or non-zero exit) as respawnable;
      // foreground keeps the historical behavior (signal = fatal).
      if (result.signal && !daemon) {
        throw new Error(`Native TypeScript child exited from ${result.signal}`);
      }
      const plan = planRespawn(result.code ?? 1, parsed.once, daemon, attempts);
      attempts = plan.attempts;
      if (!plan.respawn) {
        process.exitCode = result.code ?? 1;
        return true;
      }
      if (daemon) {
        getLogger('runtime').warn(formatCompact({
          op: 'daemon_respawn',
          code: result.code,
          signal: result.signal,
          attempts: attempts.length,
        }));
      }
      await new Promise((resolve) => { setTimeout(resolve, RESPAWN_DELAY_MS); });
      if (interrupted) {
        process.exitCode = 130;
        return true;
      }
    }
  } finally {
    removePidFile();
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.off('SIGHUP', onSighup);
    process.off('exit', onExit);
  }
}

interface StartOptions {
  readonly once: boolean;
  readonly noWatch: boolean;
  readonly environment: string;
  readonly mode: RuntimeMode;
  readonly daemon: boolean;
  readonly logFile?: string;
}

function parseStartOptions(args: readonly string[]): StartOptions {
  let once = false;
  let noWatch = false;
  let environment = 'development';
  let mode: RuntimeMode = 'development';
  let daemon = false;
  let logFile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--once') once = true;
    else if (argument === '--no-watch') noWatch = true;
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
  return { once, noWatch, environment, mode, daemon, logFile };
}

function parseMode(value: string | undefined): RuntimeMode {
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error(`Invalid Runtime mode: ${value || '<empty>'}`);
}

async function createEndpointOwnerResolver(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<(adapterLocalName: string, endpointId: string) => string | undefined> {
  const document = await readConfigDocumentValue(config);
  const map = new Map<string, string>();
  if (!document || typeof document !== 'object') {
    return () => undefined;
  }
  const plugins = (document as Record<string, unknown>).plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    return () => undefined;
  }
  const expanded = expandEnvironmentValue(plugins, (key) => process.env[key]) as Record<string, unknown>;
  for (const [pluginKey, raw] of Object.entries(expanded)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const cfg = raw as Record<string, unknown>;
    if (cfg.master != null && String(cfg.master).trim() !== '') {
      const master = String(cfg.master);
      map.set(pluginKey, master);
      if (cfg.name != null && String(cfg.name).trim() !== '') {
        map.set(String(cfg.name), master);
      }
    }
    if (Array.isArray(cfg.endpoints)) {
      for (const entry of cfg.endpoints) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const ep = entry as Record<string, unknown>;
        if (ep.owner == null || String(ep.owner).trim() === '') continue;
        const owner = String(ep.owner);
        map.set(pluginKey, owner);
        if (ep.name != null && String(ep.name).trim() !== '') {
          map.set(String(ep.name), owner);
        }
      }
    }
  }
  return (adapterLocalName, endpointId) =>
    map.get(adapterLocalName) ?? map.get(endpointId);
}

async function applyRuntimeLogLevel(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<void> {
  const document = await readConfigDocumentValue(config);
  if (!document || typeof document !== 'object') return;
  const raw = (document as Record<string, unknown>).log_level;
  if (raw === undefined || raw === null) return;
  // Prefer config; allow ZHIN_LOG_LEVEL / LOG_LEVEL to override for one-shot debug.
  const envLevel = process.env.ZHIN_LOG_LEVEL ?? process.env.LOG_LEVEL;
  setLevel((envLevel ?? raw) as LogLevelInput, undefined, true);
}

async function readConfigDocumentValue(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!config || typeof config !== 'object') return config;
  const candidate = config as Partial<ConfigDocumentPort>;
  if (typeof candidate.read === 'function') {
    const snapshot = await candidate.read();
    return snapshot && typeof snapshot === 'object' && 'document' in snapshot
      ? (snapshot as { document: unknown }).document
      : snapshot;
  }
  return config;
}

async function loadProjectConfig(
  root: string,
): Promise<{ config: RuntimeConfigDocument | ConfigDocumentPort; file: string | undefined }> {
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
  if (!file) return { config: Object.freeze({}), file: undefined };
  if (file.endsWith('.yml') || file.endsWith('.yaml')) {
    return { config: new YamlConfigDocument(file), file };
  }
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} must contain an object`);
  }
  return { config: Object.freeze(value as RuntimeConfigDocument), file };
}
