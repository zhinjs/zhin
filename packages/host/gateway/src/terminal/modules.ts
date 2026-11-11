/**
 * Minimal structural views of `node-pty` and `ssh2`. Both are optional
 * dependencies, loaded with `import()` only when a terminal is actually used.
 */

export interface PtyDisposable {
  dispose(): void;
}

export interface PtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): PtyDisposable | void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable | void;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause?(): void;
  resume?(): void;
}

export interface PtySpawnOptions {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface PtyModule {
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcess;
}

export interface SshChannel {
  on(event: 'data', listener: (data: Buffer) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal?: string) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  readonly stderr?: { on(event: 'data', listener: (data: Buffer) => void): unknown };
  write(data: Buffer | string): unknown;
  setWindow(rows: number, cols: number, height: number, width: number): unknown;
  close?(): unknown;
  pause?(): unknown;
  resume?(): unknown;
}

export interface SshConnectConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly privateKey?: Buffer | string;
  readonly passphrase?: string;
  readonly password?: string;
  readonly readyTimeout?: number;
  readonly keepaliveInterval?: number;
  readonly hostVerifier?: (key: Buffer) => boolean;
}

export interface SshClient {
  on(event: 'ready', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  connect(config: SshConnectConfig): unknown;
  shell(
    window: { term: string; cols: number; rows: number },
    callback: (error: Error | undefined, channel: SshChannel) => void,
  ): unknown;
  end(): unknown;
}

export interface SshModule {
  readonly Client: new () => SshClient;
}

export interface TerminalModuleLoaders {
  readonly loadPty?: () => Promise<PtyModule>;
  readonly loadSsh?: () => Promise<SshModule>;
}

export type ModuleLoadResult<T> =
  | { readonly ok: true; readonly module: T }
  | { readonly ok: false; readonly reason: string };

// Non-literal specifiers keep TypeScript and bundlers from requiring the packages.
const PTY_SPECIFIER = 'node-pty';
const SSH_SPECIFIER = 'ssh2';

export async function importNodePty(): Promise<PtyModule> {
  const mod = await import(/* @vite-ignore */ PTY_SPECIFIER) as { spawn?: unknown; default?: { spawn?: unknown } };
  const spawn = typeof mod.spawn === 'function' ? mod.spawn : mod.default?.spawn;
  if (typeof spawn !== 'function') throw new Error('node-pty does not export spawn()');
  return { spawn: spawn as PtyModule['spawn'] };
}

export async function importSsh2(): Promise<SshModule> {
  const mod = await import(/* @vite-ignore */ SSH_SPECIFIER) as { Client?: unknown; default?: { Client?: unknown } };
  const Client = typeof mod.Client === 'function' ? mod.Client : mod.default?.Client;
  if (typeof Client !== 'function') throw new Error('ssh2 does not export Client');
  return { Client: Client as SshModule['Client'] };
}

/** Caches one load attempt per module; a failure is reported as an install hint. */
export function createModuleCache(loaders: TerminalModuleLoaders = {}): {
  pty(): Promise<ModuleLoadResult<PtyModule>>;
  ssh(): Promise<ModuleLoadResult<SshModule>>;
} {
  let pty: Promise<ModuleLoadResult<PtyModule>> | undefined;
  let ssh: Promise<ModuleLoadResult<SshModule>> | undefined;
  return {
    pty() {
      pty ??= settle(loaders.loadPty ?? importNodePty, 'node-pty');
      return pty;
    },
    ssh() {
      ssh ??= settle(loaders.loadSsh ?? importSsh2, 'ssh2');
      return ssh;
    },
  };
}

async function settle<T>(load: () => Promise<T>, name: string): Promise<ModuleLoadResult<T>> {
  try {
    return { ok: true, module: await load() };
  } catch {
    return { ok: false, reason: `${name} 不可用（可选依赖未安装或原生模块构建失败）：在项目中执行 pnpm add ${name} 后重启` };
  }
}
