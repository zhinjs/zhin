import { EndpointDeliveryError } from '@zhin.js/im-contract';

export interface EndpointOperationOptions { readonly signal?: AbortSignal; }
export interface EndpointOperation {
  readonly signal?: AbortSignal;
  /** Preparing an effect may issue read requests, but has not submitted that effect itself. */
  prepare<T>(execute: () => T | PromiseLike<T>): Promise<T>;
  /** A submitted native effect may outlive cancellation; a late result never resumes this operation. */
  run<T>(execute: () => T | PromiseLike<T>): Promise<T>;
}

/**
 * One semantic request captures one lifetime. Every native stage reuses this scope so cancellation
 * ends its logical wait and prevents later submissions even when the SDK has no abort API.
 * Owned RPC/fetch transports keep their more precise wire evidence and consume the signal directly.
 */
export function createEndpointOperation({ signal }: EndpointOperationOptions = {}): EndpointOperation {
  // Evidence belongs to the entire action, including earlier accepted bubbles or media publications.
  let effectSubmitted = false;
  const execute = <T>(invoke: () => T | PromiseLike<T>, effect: 'prepare' | 'submit'): Promise<T> => {
    if (signal?.aborted) return Promise.reject(new EndpointDeliveryError('endpoint_inactive', 'Endpoint operation ended', effectSubmitted ? 'unknown' : 'not_sent'));
    return new Promise<T>((resolve, reject) => {
      let active = true;
      const settle = (result: { value: T } | { error: unknown }) => {
        if (!active) return;
        active = false;
        signal?.removeEventListener('abort', onAbort);
        if ('error' in result) reject(result.error); else resolve(result.value);
      };
      const onAbort = () => settle({ error: new EndpointDeliveryError('endpoint_inactive',
        'Endpoint operation cancelled',
        effectSubmitted ? 'unknown' : 'not_sent', { cause: signal?.reason }) });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      try {
        if (effect === 'submit') effectSubmitted = true;
        Promise.resolve(invoke()).then(value => settle({ value }), error => settle({ error }));
      } catch (error) { settle({ error }); }
    });
  };
  return Object.freeze({ signal,
    prepare: <T>(invoke: () => T | PromiseLike<T>) => execute(invoke, 'prepare'),
    run: <T>(invoke: () => T | PromiseLike<T>) => execute(invoke, 'submit'),
  });
}
