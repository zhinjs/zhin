/**
 * JSON-lines protocol of the local control socket (ADR 0054 §6). One request per line:
 * `{ id, type, data? }`; the gateway answers each with `{ id, ok, data | error }` and may send
 * `{ id, event }` lines before it (package transaction progress). `type` is a `gateway.*` RPC
 * type (answered with principal `'local'`) or one of the local-only {@link LOCAL_GATEWAY_RPC}.
 */
import type { GatewayInstanceStatus, GatewayPackageEvent, GatewayRpcErrorCode, GatewayRpcErrorDetails } from '@zhin.js/console-protocol';

/** Socket-only RPC: not reachable over HTTP. */
export const LOCAL_GATEWAY_RPC = Object.freeze({
  /** Gateway process info and instance status. */
  INFO: 'gateway.info',
  /** Stops the instance, then the gateway. */
  SHUTDOWN: 'gateway.shutdown',
  /**
   * `zhin console init` beside a running gateway (ADR 0049 §7): the gateway's own
   * `ConsoleSetupService` answers, so a database switch is applied live (reconnect + instance
   * restart) and the owner state changes at once.
   */
  CONSOLE_SETUP_STATUS: 'gateway.console.setup.status',
  CONSOLE_SETUP_DRIVERS: 'gateway.console.setup.drivers',
  /** `{ dialect, connection }` → the probe result. */
  CONSOLE_SETUP_DATABASE_TEST: 'gateway.console.setup.database.test',
  /** `{ dialect, connection }`: writes the config, reconnects the gateway, restarts the instance. */
  CONSOLE_SETUP_DATABASE: 'gateway.console.setup.database',
  /** `{ username, password, displayName? }`: the first owner. */
  CONSOLE_SETUP_OWNER: 'gateway.console.setup.owner',
  /** `zhin console user …` beside a running gateway: the gateway's `ConsoleIamService` answers. */
  CONSOLE_USER_LIST: 'gateway.console.user.list',
  /** `{ username, password, displayName?, role }`. */
  CONSOLE_USER_CREATE: 'gateway.console.user.create',
  /** `{ username, password }`: resets the password (revokes the user's sessions). */
  CONSOLE_USER_PASSWD: 'gateway.console.user.passwd',
  /** `{ username, disabled }`. */
  CONSOLE_USER_DISABLE: 'gateway.console.user.disable',
} as const);

export type LocalGatewayRpcType = (typeof LOCAL_GATEWAY_RPC)[keyof typeof LOCAL_GATEWAY_RPC];

/** Longest accepted line in either direction. */
export const MAX_LOCAL_LINE_BYTES = 1024 * 1024;

export interface LocalGatewayRequest {
  readonly id: number | string;
  readonly type: string;
  readonly data?: unknown;
}

/** Gateway RPC codes, plus the Console account codes of the `gateway.console.*` RPC. */
export type LocalGatewayErrorCode =
  | GatewayRpcErrorCode
  | 'not_found' | 'last_owner' | 'unauthorized' | 'rate_limited' | 'database_busy';

/** `errors` / `missingEnv` as in the HTTP reply ({@link GatewayRpcErrorDetails}), only when non-empty. */
export interface LocalGatewayError extends GatewayRpcErrorDetails {
  readonly code: LocalGatewayErrorCode;
  readonly message: string;
  readonly status: number;
}

export type LocalGatewayResponse =
  | Readonly<{ id: number | string; ok: true; data: unknown }>
  | Readonly<{ id: number | string; ok: false; error: LocalGatewayError }>;

export interface LocalGatewayEventLine {
  readonly id: number | string;
  readonly event: GatewayPackageEvent;
}

export type LocalGatewayServerLine = LocalGatewayResponse | LocalGatewayEventLine;

/** `.zhin/gateway.json` and the `gateway.info` answer. */
export interface LocalGatewayInfo {
  readonly pid: number;
  /** Ports of the gateway's HTTP listeners. */
  readonly ports: readonly number[];
  /** Listener origins (`http://127.0.0.1:8068`). */
  readonly origins: readonly string[];
  /** Local control endpoint (socket path or pipe name). */
  readonly socket: string;
  /** Epoch ms. */
  readonly startedAt: number;
  /** `@zhin.js/gateway` version. */
  readonly version: string;
  /** `foreground` (attached to a terminal / service manager) or `daemon` (`zhin start`). */
  readonly mode: 'foreground' | 'daemon';
  /** Start options the instance runs with (re-used by `zhin restart --gateway`). */
  readonly args: readonly string[];
  /** Instance log file. */
  readonly logFile?: string;
}

export interface LocalGatewayInfoResult {
  readonly gateway: LocalGatewayInfo;
  readonly instance: GatewayInstanceStatus;
  /** False until the first Console owner exists (the bootstrap token still works). */
  readonly consoleInitialized: boolean;
}

/** Splits a stream into lines, refusing lines longer than {@link MAX_LOCAL_LINE_BYTES}. */
export class LineDecoder {
  #buffer = '';
  constructor(readonly maxBytes = MAX_LOCAL_LINE_BYTES) {}

  /** Returns the complete lines in `chunk`; throws when a line exceeds the limit. */
  push(chunk: string): string[] {
    this.#buffer += chunk;
    const lines: string[] = [];
    for (;;) {
      const newline = this.#buffer.indexOf('\n');
      if (newline < 0) break;
      lines.push(this.#buffer.slice(0, newline));
      this.#buffer = this.#buffer.slice(newline + 1);
    }
    if (Buffer.byteLength(this.#buffer) > this.maxBytes) {
      this.#buffer = '';
      throw new Error('line too long');
    }
    return lines.filter((line) => line.trim().length > 0);
  }
}
