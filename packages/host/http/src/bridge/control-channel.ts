/**
 * Instance side of the gateway control channel (ADR 0054 §3).
 *
 * Wraps the child-process IPC port (`process.send` / `process.on('message')`). The channel is
 * unref'd so an idle IPC pipe never keeps a stopped instance alive.
 */
import {
  BridgeProtocolMismatchError,
  INSTANCE_BRIDGE_PROTOCOL_VERSION,
  INSTANCE_CHILD_ENV,
  isBridgeProtocolCompatible,
  parseGatewayMessage,
  type BridgeRouteTable,
  type GatewayShutdownPayload,
  type GatewayToInstanceMessage,
  type InstanceToGatewayMessage,
} from './protocol.js';

/** The subset of `process` the control channel needs; tests pass a fake. */
export interface InstanceIpcPort {
  send?(message: unknown, callback?: (error: Error | null) => void): boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'disconnect', listener: () => void): unknown;
  readonly connected?: boolean;
  readonly channel?: { unref?(): void; ref?(): void } | null;
}

export interface InstanceReadyDetails {
  readonly generation?: number;
  /** Route table at ready time (ADR 0054 §3 `ready { routes }`). */
  readonly routes?: BridgeRouteTable;
}

export interface InstanceControlChannel {
  /** Announces that startup completed (carries the protocol version). */
  ready(details?: InstanceReadyDetails): void;
  /** Asks the gateway for a whole-process restart; replaces the former exit code 75. */
  requestRestart(reason: string): void;
  onShutdown(listener: (payload: GatewayShutdownPayload) => void): () => void;
  /** Every validated gateway message (bridge streams, addresses, shutdown). */
  onMessage(listener: (message: GatewayToInstanceMessage) => void): () => void;
  /** Sends one bridge message; dropped once the channel is gone. */
  send(message: InstanceToGatewayMessage): void;
  /**
   * Keeps the process alive through the channel (as a listening server would) until the
   * returned release runs. Holds are counted; the channel is unref'd again at zero.
   */
  hold(): () => void;
  /** Protocol version the gateway announced through {@link INSTANCE_CHILD_ENV}, when numeric. */
  readonly gatewayVersion?: number;
  /** The gateway went away (the IPC channel closed). */
  onDisconnect(listener: () => void): () => void;
  readonly connected: boolean;
  close(): void;
}

/**
 * Opens the control channel when the gateway started this process: the IPC channel must be
 * present and {@link INSTANCE_CHILD_ENV} set. Returns `undefined` otherwise (not supervised).
 *
 * The marker matters: other parents also open an IPC channel (test runners' fork workers,
 * process managers). Treating their channel as the gateway would send control messages to
 * them and exit the process on a restart request.
 *
 * Throws {@link BridgeProtocolMismatchError} when the marker names a protocol version this build
 * cannot speak: the instance must not start against an incompatible gateway.
 */
export function openInstanceControlChannel(
  port: InstanceIpcPort = process as unknown as InstanceIpcPort,
  pid: number = process.pid,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): InstanceControlChannel | undefined {
  const marker = environment[INSTANCE_CHILD_ENV];
  if (!marker) return undefined;
  if (typeof port.send !== 'function' || port.connected === false) return undefined;
  const gatewayVersion = /^\d+$/u.test(marker) ? Number(marker) : undefined;
  if (gatewayVersion !== undefined && !isBridgeProtocolCompatible(gatewayVersion)) {
    throw new BridgeProtocolMismatchError(gatewayVersion, 'gateway');
  }
  port.channel?.unref?.();
  const shutdownListeners = new Set<(payload: GatewayShutdownPayload) => void>();
  const messageListeners = new Set<(message: GatewayToInstanceMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  let connected = true;
  let closed = false;
  let holds = 0;
  const releaseHold = (): void => {
    holds -= 1;
    if (holds === 0) port.channel?.unref?.();
  };

  const onMessage = (raw: unknown): void => {
    const message = parseGatewayMessage(raw);
    if (!message) return;
    for (const listener of [...messageListeners]) {
      try { listener(message); } catch { /* one consumer never breaks the channel */ }
    }
    if (message.type !== 'shutdown') return;
    for (const listener of [...shutdownListeners]) listener(message.payload);
  };
  const onDisconnect = (): void => {
    connected = false;
    for (const listener of [...disconnectListeners]) listener();
  };
  port.on('message', onMessage);
  port.on('disconnect', onDisconnect);

  const send = (message: InstanceToGatewayMessage): void => {
    if (!connected || closed) return;
    try {
      // The callback swallows EPIPE when the gateway is already gone.
      port.send?.(message, () => undefined);
    } catch { /* channel closed */ }
  };

  return {
    ready(details = {}) {
      send({
        type: 'ready',
        payload: {
          version: INSTANCE_BRIDGE_PROTOCOL_VERSION,
          pid,
          ...(details.generation !== undefined ? { generation: details.generation } : {}),
          ...(details.routes ? { routes: details.routes } : {}),
        },
      });
    },
    send,
    hold() {
      if (closed) return () => undefined;
      holds += 1;
      if (holds === 1) port.channel?.ref?.();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releaseHold();
      };
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },
    ...(gatewayVersion !== undefined ? { gatewayVersion } : {}),
    requestRestart(reason) {
      send({ type: 'restart-request', payload: { reason } });
    },
    onShutdown(listener) {
      shutdownListeners.add(listener);
      return () => { shutdownListeners.delete(listener); };
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => { disconnectListeners.delete(listener); };
    },
    get connected() { return connected && !closed; },
    close() {
      if (closed) return;
      closed = true;
      if (holds > 0) {
        holds = 0;
        port.channel?.unref?.();
      }
      port.off('message', onMessage);
      port.off('disconnect', onDisconnect);
      shutdownListeners.clear();
      messageListeners.clear();
      disconnectListeners.clear();
    },
  };
}
