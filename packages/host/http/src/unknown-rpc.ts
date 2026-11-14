/**
 * Unknown Console RPC (zhinjs/zhin#1250): not a security refusal, so it is never audited. A
 * Console that polls an RPC this Host lacks would otherwise fill the audit log; instead each type
 * is logged at debug level at most once per window, with how often it was seen meanwhile.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('console-rpc');
const WINDOW_MS = 10 * 60_000;
const MAX_TYPES = 256;

interface Seen { at: number; suppressed: number }

export interface UnknownRpcLog {
  /** Records one unknown RPC; returns true when it was logged (not suppressed). */
  note(type: unknown, now?: number): boolean;
}

export type UnknownRpcLogEntry = Readonly<{ op: 'console_rpc_unknown'; type: string; repeated?: number }>;

export function createUnknownRpcLog(log: (entry: UnknownRpcLogEntry) => void = entry => logger.debug(formatCompact({ ...entry }))): UnknownRpcLog {
  const seen = new Map<string, Seen>();
  return Object.freeze({
    note(type: unknown, now = Date.now()): boolean {
      const name = String(type ?? '').slice(0, 64) || '<empty>';
      const entry = seen.get(name);
      if (entry && now - entry.at < WINDOW_MS) {
        entry.suppressed += 1;
        return false;
      }
      if (!entry && seen.size >= MAX_TYPES) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.delete(name);
      seen.set(name, { at: now, suppressed: 0 });
      log({ op: 'console_rpc_unknown', type: name, ...(entry?.suppressed ? { repeated: entry.suppressed } : {}) });
      return true;
    },
  });
}

/** Process-wide log shared by the Host's RPC routes. */
export const unknownRpcLog: UnknownRpcLog = createUnknownRpcLog();
