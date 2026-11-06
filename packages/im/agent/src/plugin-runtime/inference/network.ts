import type {
  ProviderAccount,
  ProviderDefinition,
  ProviderService,
  ProviderTargets,
} from '@zhin.js/ai/provider';
import { createPersonalModelFetch } from './personal-network.js';

export type ProviderNetworkPurpose = keyof ProviderTargets | 'preparation';
export class InferenceNetworkError extends Error {
  constructor(readonly code: 'target-denied' | 'redirect-denied' | 'transport') {
    super(`Inference network: ${code}`);
    this.name = 'InferenceNetworkError';
  }
}

/** Normalize origin and path boundaries. Never substring-match a host or accept credential-bearing descriptors. */
export function matchesProviderTarget(target: URL, prefixes: readonly string[]): boolean {
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password)
    return false;
  return prefixes.some((prefix) => {
    let expected: URL;
    try {
      expected = new URL(prefix);
    } catch {
      return false;
    }
    if (
      expected.username ||
      expected.password ||
      expected.search ||
      expected.hash ||
      expected.origin !== target.origin
    )
      return false;
    const path = expected.pathname.replace(/\/+$/u, '');
    return !path || target.pathname === path || target.pathname.startsWith(`${path}/`);
  });
}

export interface ProviderNetworkOptions {
  readonly account: ProviderAccount;
  readonly service: ProviderService;
  readonly definition: ProviderDefinition<unknown, unknown>;
  readonly hostOwnerId: string;
  readonly purpose: ProviderNetworkPurpose;
  readonly hostFetch?: typeof globalThis.fetch;
  /** Trusted accounting admission immediately before inference transport submission. */
  readonly beforeSubmit?: () => void;
  /** Private owner of Request followers until the response body is consumed or the operation ends. */
  readonly retainTransportState?: (state: Request | AbortSignal) => void;
  /** Test/Host seam only, never a management payload option. */
  readonly personalFetch?: (origin: string) => typeof globalThis.fetch;
}

/** Account ownership selects the existing Host/private network boundary; a shared Service never grants private access. */
export function createProviderNetwork(options: ProviderNetworkOptions): typeof globalThis.fetch {
  const declared = options.definition.targets(options.service);
  const targets =
    options.purpose === 'preparation'
      ? [...(declared.identity ?? []), ...(declared.discovery ?? [])]
      : declared[options.purpose] ?? [];
  const personal = new Map<string, typeof globalThis.fetch>();
  return async (input, init) => {
    let request = new Request(input, init);
    options.retainTransportState?.(request);
    request.signal.throwIfAborted();
    let target = new URL(request.url);
    if (!matchesProviderTarget(target, targets)) throw new InferenceNetworkError('target-denied');
    if (options.account.ownerId !== options.hostOwnerId) {
      let fetch = personal.get(target.origin);
      if (!fetch) {
        const supplied = options.personalFetch?.(target.origin);
        fetch = supplied
          ? (input, init) => {
              options.beforeSubmit?.();
              return supplied(input, init);
            }
          : createPersonalModelFetch({
              baseUrl: target.origin,
              beforeSubmit: options.beforeSubmit,
              retainTransportState: options.retainTransportState,
            });
        personal.set(target.origin, fetch);
      }
      // Reauthorize each redirect in this outer loop too, including a narrower provider path prefix.
      return follow(request, target, fetch);
    }
    return follow(request, target, options.hostFetch ?? globalThis.fetch);

    async function follow(
      first: Request,
      initial: URL,
      fetch: typeof globalThis.fetch
    ): Promise<Response> {
      const bytes = first.body ? await first.arrayBuffer() : undefined;
      const headers = new Headers(first.headers);
      let method = first.method;
      request = first;
      target = initial;
      for (let redirects = 0; ; redirects++) {
        request.signal.throwIfAborted();
        if (!matchesProviderTarget(target, targets))
          throw new InferenceNetworkError('target-denied');
        const submit = () =>
          fetch(target, {
            method,
            headers,
            signal: request.signal,
            redirect: 'manual' as const,
            ...(method === 'GET' || method === 'HEAD' || bytes === undefined
              ? {}
              : { body: bytes }),
          });
        let response: Response;
        if (options.account.ownerId !== options.hostOwnerId) {
          // The personal port already owns transport sanitization and DNS admission.
          // Its trusted pre-submit quota rejection must retain its business meaning.
          response = await submit();
        } else {
          options.beforeSubmit?.();
          try {
            response = await submit();
          } catch {
            request.signal.throwIfAborted();
            throw new InferenceNetworkError('transport');
          }
        }
        const location = response.headers.get('location');
        if (
          ![301, 302, 303, 307, 308].includes(response.status) ||
          !location ||
          request.redirect === 'manual'
        )
          return response;
        await response.body?.cancel();
        // Same 20-hop boundary as Fetch/undici; no new provider retry or redirect policy is introduced.
        if (request.redirect === 'error' || redirects === 20)
          throw new InferenceNetworkError('redirect-denied');
        let next: URL;
        try {
          next = new URL(location, target);
        } catch {
          throw new InferenceNetworkError('redirect-denied');
        }
        if (next.origin !== initial.origin || !matchesProviderTarget(next, targets))
          throw new InferenceNetworkError('redirect-denied');
        if (
          ((response.status === 301 || response.status === 302) && method === 'POST') ||
          (response.status === 303 && method !== 'GET' && method !== 'HEAD')
        ) {
          method = 'GET';
          for (const name of [
            'content-encoding',
            'content-language',
            'content-location',
            'content-type',
            'content-length',
          ])
            headers.delete(name);
        }
        target = next;
      }
    }
  };
}
