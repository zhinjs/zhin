import { hostKeyFingerprint, type SshCredentials, type TerminalSshTargetConfig } from './config.js';
import type { PtyModule, SshChannel, SshClient, SshModule } from './modules.js';

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalExit {
  readonly code: number | null;
  readonly signal?: string | number;
}

export interface TerminalBackendEvents {
  onData(chunk: Buffer | string): void;
  onExit(exit: TerminalExit): void;
}

/** A running shell (local PTY or SSH channel). `kill()` is idempotent. */
export interface TerminalBackend {
  write(data: Buffer): void;
  resize(size: TerminalSize): void;
  kill(): void;
  pause(): void;
  resume(): void;
}

export class TerminalStartError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TerminalStartError';
  }
}

const TERM = 'xterm-256color';

export function startLocalBackend(
  pty: PtyModule,
  options: { shell: string; cwd: string; env?: NodeJS.ProcessEnv },
  size: TerminalSize,
  events: TerminalBackendEvents,
): TerminalBackend {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.TERM = TERM;
  let proc;
  try {
    proc = pty.spawn(options.shell, [], { name: TERM, cols: size.cols, rows: size.rows, cwd: options.cwd, env });
  } catch (error) {
    throw new TerminalStartError('spawn-failed', `无法启动 Shell：${error instanceof Error ? error.message : String(error)}`);
  }
  let exited = false;
  proc.onData((data) => {
    if (!exited) events.onData(data);
  });
  proc.onExit(({ exitCode, signal }) => {
    if (exited) return;
    exited = true;
    events.onExit({ code: exitCode, ...(signal ? { signal } : {}) });
  });
  return {
    write(data) {
      if (!exited) proc.write(data.toString('utf8'));
    },
    resize({ cols, rows }) {
      if (!exited) proc.resize(cols, rows);
    },
    kill() {
      if (exited) return;
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    },
    pause() {
      proc.pause?.();
    },
    resume() {
      proc.resume?.();
    },
  };
}

export interface SshStartOptions {
  readonly readyTimeoutMs?: number;
  /** Receives the observed host fingerprint (not secret) so operators can pin it. */
  readonly onHostKey?: (fingerprint: string) => void;
}

/** Connects and opens an interactive shell. Resolves once the channel is open. */
export function startSshBackend(
  ssh: SshModule,
  target: TerminalSshTargetConfig,
  credentials: SshCredentials,
  size: TerminalSize,
  events: TerminalBackendEvents,
  options: SshStartOptions = {},
): Promise<TerminalBackend> {
  return new Promise((resolve, reject) => {
    const client: SshClient = new ssh.Client();
    let channel: SshChannel | undefined;
    let settled = false;
    let finished = false;
    let fingerprintMismatch = false;
    let exit: TerminalExit = { code: null };

    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      if (settled) events.onExit(exit);
    };
    const fail = (error: TerminalStartError) => {
      if (settled) return;
      settled = true;
      finished = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(error);
    };

    client.on('error', (error) => {
      if (!settled) {
        fail(fingerprintMismatch
          ? new TerminalStartError('host-fingerprint-mismatch', `SSH 主机指纹与配置不符（${target.name}）`)
          : new TerminalStartError('ssh-connect-failed', `SSH 连接失败（${target.name}）：${error.message}`));
        return;
      }
      finish();
    });
    client.on('close', () => {
      if (!settled) {
        fail(fingerprintMismatch
          ? new TerminalStartError('host-fingerprint-mismatch', `SSH 主机指纹与配置不符（${target.name}）`)
          : new TerminalStartError('ssh-connect-failed', `SSH 连接已关闭（${target.name}）`));
        return;
      }
      finish();
    });
    client.on('ready', () => {
      client.shell({ term: TERM, cols: size.cols, rows: size.rows }, (error, opened) => {
        if (error) {
          fail(new TerminalStartError('ssh-shell-failed', `无法打开远程 Shell（${target.name}）：${error.message}`));
          return;
        }
        if (finished) {
          opened.close?.();
          return;
        }
        channel = opened;
        opened.on('data', (data) => {
          if (!finished) events.onData(data);
        });
        opened.stderr?.on('data', (data) => {
          if (!finished) events.onData(data);
        });
        opened.on('exit', (code, signal) => {
          exit = { code: code ?? null, ...(signal ? { signal } : {}) };
        });
        opened.on('close', finish);
        settled = true;
        resolve({
          write(data) {
            if (!finished) opened.write(data);
          },
          resize({ cols, rows }) {
            if (!finished) opened.setWindow(rows, cols, 0, 0);
          },
          kill() {
            if (finished) return;
            try {
              channel?.close?.();
            } catch {
              /* ignore */
            }
            finish();
          },
          pause() {
            opened.pause?.();
          },
          resume() {
            opened.resume?.();
          },
        });
      });
    });

    try {
      client.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        ...credentials,
        readyTimeout: options.readyTimeoutMs ?? 20_000,
        keepaliveInterval: 30_000,
        hostVerifier: (key: Buffer) => {
          const observed = hostKeyFingerprint(key);
          options.onHostKey?.(observed);
          // Deny by default: only an explicit opt-out skips the pin.
          if (target.insecureAcceptAnyHostKey !== true && observed !== target.hostFingerprint) {
            fingerprintMismatch = true;
            return false;
          }
          return true;
        },
      });
    } catch (error) {
      fail(new TerminalStartError('ssh-connect-failed', `SSH 连接失败（${target.name}）：${error instanceof Error ? error.message : String(error)}`));
    }
  });
}
