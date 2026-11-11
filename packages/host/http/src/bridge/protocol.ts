/**
 * Gateway ↔ instance control channel protocol (ADR 0054 §3).
 *
 * The channel is the Node child-process IPC channel opened by the gateway with
 * `serialization: 'advanced'`. Every message is `{ type, id?, payload }`. Both sides import
 * this module so the message shapes and the protocol version stay in one place.
 *
 * This module must not import `node:http` / `ws`: the instance loads it.
 */

/** Bumped on any incompatible change to the control channel messages. */
export const INSTANCE_BRIDGE_PROTOCOL_VERSION = 1;

/** Set by the gateway on the instance child process; marks the process as a supervised instance. */
export const INSTANCE_CHILD_ENV = 'ZHIN_RUNTIME_CHILD';

export interface BridgeMessage<Type extends string, Payload> {
  readonly type: Type;
  readonly id?: string;
  readonly payload: Payload;
}

// ---- instance → gateway

export interface InstanceReadyPayload {
  /** {@link INSTANCE_BRIDGE_PROTOCOL_VERSION} the instance was built with. */
  readonly version: number;
  /** Committed Runtime generation at the time the instance became ready. */
  readonly generation?: number;
  readonly pid: number;
}

export interface InstanceRestartRequestPayload {
  /** Short machine-readable reason, e.g. `console`, `dependencies`, `self-change`. */
  readonly reason: string;
}

export type InstanceReadyMessage = BridgeMessage<'ready', InstanceReadyPayload>;
export type InstanceRestartRequestMessage = BridgeMessage<'restart-request', InstanceRestartRequestPayload>;
export type InstanceToGatewayMessage = InstanceReadyMessage | InstanceRestartRequestMessage;

// ---- gateway → instance

export interface GatewayShutdownPayload {
  /** Why the gateway stops the instance, e.g. `stop`, `restart`, `protocol-mismatch`. */
  readonly reason: string;
  /** Graceful stop budget; the gateway escalates to SIGTERM / SIGKILL after it. */
  readonly budgetMs: number;
}

export type GatewayShutdownMessage = BridgeMessage<'shutdown', GatewayShutdownPayload>;
export type GatewayToInstanceMessage = GatewayShutdownMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasValidId(message: Record<string, unknown>): boolean {
  return message.id === undefined || typeof message.id === 'string';
}

/** Validates an untrusted message received from the instance. */
export function parseInstanceMessage(value: unknown): InstanceToGatewayMessage | undefined {
  if (!isRecord(value) || !hasValidId(value) || !isRecord(value.payload)) return undefined;
  const payload = value.payload;
  switch (value.type) {
    case 'ready':
      if (!Number.isSafeInteger(payload.version)) return undefined;
      if (!Number.isSafeInteger(payload.pid)) return undefined;
      if (payload.generation !== undefined && !isFiniteNonNegative(payload.generation)) return undefined;
      return value as unknown as InstanceReadyMessage;
    case 'restart-request':
      if (typeof payload.reason !== 'string') return undefined;
      return value as unknown as InstanceRestartRequestMessage;
    default:
      return undefined;
  }
}

/** Validates an untrusted message received from the gateway. */
export function parseGatewayMessage(value: unknown): GatewayToInstanceMessage | undefined {
  if (!isRecord(value) || !hasValidId(value) || !isRecord(value.payload)) return undefined;
  const payload = value.payload;
  switch (value.type) {
    case 'shutdown':
      if (typeof payload.reason !== 'string' || !isFiniteNonNegative(payload.budgetMs)) return undefined;
      return value as unknown as GatewayShutdownMessage;
    default:
      return undefined;
  }
}
