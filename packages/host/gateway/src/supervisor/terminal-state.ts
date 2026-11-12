/**
 * The foreground gateway's terminal, shared with the instance when it inherits stdin (terminal
 * adapters, login assist). Node has no `tcgetpgrp` / termios API, so this uses `/proc` and
 * `stty` / `ps` (Unix only; Windows consoles are left as they are).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface TerminalProbe {
  readonly platform?: NodeJS.Platform;
  readonly pid?: number;
  /** `/proc/<pid>/stat` text (Linux). */
  readonly readStat?: (pid: number) => string;
  /** `ps -o pgid=,tpgid= -p <pid>` output (other Unix). */
  readonly ps?: (pid: number) => string;
}

/**
 * Whether this process is in the terminal's foreground process group. A background job
 * (`zhin start --foreground &`) must not hand its TTY stdin to the instance: reading it would
 * stop the instance with SIGTTIN. Unknown (no controlling terminal, probe failed) counts as
 * foreground, the previous behaviour.
 */
export function isForegroundProcessGroup(probe: TerminalProbe = {}): boolean {
  const platform = probe.platform ?? process.platform;
  if (platform === 'win32') return true;
  const pid = probe.pid ?? process.pid;
  try {
    if (platform === 'linux') {
      const stat = (probe.readStat ?? ((id) => readFileSync(`/proc/${id}/stat`, 'utf8')))(pid);
      // `pid (comm) state ppid pgrp session tty_nr tpgid …`; comm may contain spaces and ')'.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
      const pgrp = Number(fields[2]);
      const tpgid = Number(fields[5]);
      if (!Number.isInteger(pgrp) || !Number.isInteger(tpgid) || tpgid <= 0) return true;
      return pgrp === tpgid;
    }
    const output = (probe.ps ?? ((id) => spawnSync('ps', ['-o', 'pgid=,tpgid=', '-p', String(id)], { encoding: 'utf8' }).stdout ?? ''))(pid);
    const [pgid, tpgid] = output.trim().split(/\s+/u).map(Number);
    if (!Number.isInteger(pgid) || !Number.isInteger(tpgid) || tpgid! <= 0) return true;
    return pgid === tpgid;
  } catch {
    return true;
  }
}

export interface TerminalState {
  /** Puts the terminal back as it was when captured (e.g. after an instance left it in raw mode). */
  restore(): void;
}

/** Runs `stty` on the inherited terminal; undefined when it fails. */
export type SttyRunner = (args: readonly string[]) => string | undefined;

const runStty: SttyRunner = (args) => {
  const result = spawnSync('stty', [...args], { stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
};

/**
 * Saves the terminal settings (`stty -g`) so they can be restored once the instance that shares
 * the TTY exits — a crashed terminal adapter can leave it in raw / no-echo mode. Undefined on
 * Windows or without a usable `stty`.
 */
export function captureTerminalState(options: { readonly platform?: NodeJS.Platform; readonly stty?: SttyRunner } = {}): TerminalState | undefined {
  if ((options.platform ?? process.platform) === 'win32') return undefined;
  const stty = options.stty ?? runStty;
  const saved = stty(['-g']);
  if (!saved) return undefined;
  return Object.freeze({ restore: () => { stty([saved]); } });
}
