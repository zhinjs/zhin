/**
 * ICQQ login control surface exposed to the Plugin Runtime, Console and the
 * recovery command. One control per endpoint instance (UIN), provided by the
 * ICQQ plugin setup and filled by `adapters/icqq/create()`.
 */
import { createToken } from 'zhin.js';
import type { PendingLoginTask } from '@zhin.js/core';

export interface IcqqLoginControlState {
  readonly endpointId: string;
  readonly transportState: string;
  readonly online: boolean;
  readonly pending: readonly PendingLoginTask[];
}

export interface IcqqLoginControl {
  readonly endpointId: string;
  state(): IcqqLoginControlState;
  pending(): readonly PendingLoginTask[];
  /** Force a login attempt; rejects when the endpoint is stopped or the SDK login fails. */
  relogin(): Promise<void>;
  submit(taskId: string, value: string | Record<string, unknown>): boolean;
  cancel(taskId: string, reason?: string): boolean;
}

/** `endpoint id (QQ uin)` → control for the current generation. */
export const icqqLoginControlToken = createToken<Map<string, IcqqLoginControl>>(
  'zhin.icqq.login-control',
  'ICQQ login control surface for recovery commands',
);
