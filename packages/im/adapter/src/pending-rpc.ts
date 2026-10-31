import { EndpointDeliveryError } from '@zhin.js/im-contract';

/** The owning protocol supplies a live writer; connection/reconnection stays with its lifecycle. */
export interface PendingRpcTransport { send(payload: string): void; }
export interface PendingRpcRequest {
  readonly action: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /** One operation can end without retiring the account or cancelling other operations. */
  readonly signal?: AbortSignal;
}
export interface PendingRpcEnvelope extends Pick<PendingRpcRequest, 'action' | 'params'> { readonly id: string; }
export interface PendingRpcOptions {
  readonly signal?: AbortSignal;
  readonly requestPrefix: string;
  /** Protocol policy, supplied explicitly rather than introducing a framework timeout default. */
  readonly timeoutMs: number;
  readonly transport: () => PendingRpcTransport | undefined;
  readonly serialize: (request: PendingRpcEnvelope) => string;
}
export interface PendingRpc<Response> {
  call(request: PendingRpcRequest): Promise<Response>;
  accept(response: Readonly<{ id: string; value: Response }>): void;
  /** Disconnect/replacement settles this connection's requests without replaying them. */
  disconnect(message?: string): void;
  /** Final incarnation disposal also removes its cancellation subscription. */
  dispose(): void;
  readonly pendingCount: number;
}

/**
 * @internal One Client owns correlation, timers and cancellation together. Submitted requests
 * have unknown outcomes on cancellation/disconnection; requests rejected before send are not_sent.
 */
export function createPendingRpc<Response>(options: PendingRpcOptions): PendingRpc<Response> {
  const pending = new Map<string, { settle: (result: { value: Response } | { error: unknown }) => void }>();
  let sequence = 0;
  let disposed = false;
  const disconnect = (message = 'Connection closed') => {
    for (const entry of [...pending.values()]) entry.settle({ error:
      new EndpointDeliveryError('endpoint_disconnected', message, 'unknown') });
  };
  const onRetire = () => disconnect('Endpoint execution retired');
  options.signal?.addEventListener('abort', onRetire, { once: true });
  return Object.freeze({
    get pendingCount() { return pending.size; },
    call(request: PendingRpcRequest): Promise<Response> {
      if (disposed || options.signal?.aborted || request.signal?.aborted) return Promise.reject(
        new EndpointDeliveryError('endpoint_inactive', 'Endpoint operation is no longer active', 'not_sent'));
      const transport = options.transport();
      if (!transport) return Promise.reject(new EndpointDeliveryError('endpoint_disconnected', 'WebSocket 未连接', 'not_sent'));
      const id = `${options.requestPrefix}${++sequence}`;
      // Encoding cannot submit an effect. Fail before creating timers or retaining any listener.
      let payload: string;
      try { payload = options.serialize({ id, action: request.action, params: request.params }); }
      catch (cause) { return Promise.reject(new EndpointDeliveryError('invalid_request',
        cause instanceof Error ? cause.message : String(cause), 'not_sent', { cause })); }
      return new Promise<Response>((resolve, reject) => {
        let settled = false;
        let submitted = false;
        const onAbort = () => settle({ error: new EndpointDeliveryError('endpoint_inactive',
          'Endpoint operation cancelled', submitted ? 'unknown' : 'not_sent', { cause: request.signal?.reason }) });
        const timeout = setTimeout(() => settle({ error: new EndpointDeliveryError('endpoint_timeout',
          `Action timed out: ${request.action}`, submitted ? 'unknown' : 'not_sent') }), options.timeoutMs);
        const settle = (result: { value: Response } | { error: unknown }) => {
          if (settled) return;
          settled = true;
          pending.delete(id);
          clearTimeout(timeout);
          request.signal?.removeEventListener('abort', onAbort);
          if ('error' in result) reject(result.error); else resolve(result.value);
        };
        pending.set(id, { settle });
        request.signal?.addEventListener('abort', onAbort, { once: true });
        if (disposed || options.signal?.aborted || request.signal?.aborted) { onAbort(); return; }
        try { submitted = true; transport.send(payload); }
        catch (cause) { settle({ error: cause instanceof EndpointDeliveryError ? cause : new EndpointDeliveryError(
          'endpoint_send_failed', cause instanceof Error ? cause.message : String(cause), 'unknown', { cause }) }); }
      });
    },
    accept({ id, value }: Readonly<{ id: string; value: Response }>) { pending.get(id)?.settle({ value }); },
    disconnect,
    dispose() {
      disposed = true;
      options.signal?.removeEventListener('abort', onRetire);
      disconnect('Endpoint disposed');
    },
  });
}
