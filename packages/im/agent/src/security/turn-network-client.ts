import { getLogger } from '@zhin.js/logger';
import { NETWORK_DISABLED_REASON } from './network-authority.js';
import type { ToolInvocationPolicy } from '@zhin.js/tool';
import {
  checkUrlNetworkAccess,
  NetworkAccessDeniedError,
  NodeNetworkTransport,
  type NetworkBinaryResponse,
  type NetworkTextResponse,
  type NetworkTransport,
} from '@zhin.js/kernel';

// The pinned transport lives in `@zhin.js/kernel` so the IM core and adapters share it (#1250 第 46 批).
export { bareUrlHost, NodeNetworkTransport } from '@zhin.js/kernel';
export type {
  NetworkAddressLookup,
  NetworkBinaryResponse,
  NetworkTextResponse,
  NetworkTransport,
  NodeNetworkTransportOptions,
  PinnedAddressConnect,
} from '@zhin.js/kernel';

const logger = getLogger('TurnNetworkClient');

/** Fixed reason for a refused redirect hop: the target's host stays in the debug log only. */
export const REDIRECT_DENIED_REASON = '网络请求被重定向到不允许访问的地址，已拦截';
/** Fixed reason for any other failure of a redirect hop (DNS, TLS, connection). */
export const REDIRECT_FAILED_REASON = '网络请求在重定向后失败';

export interface NetworkRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly maxBytes?: number;
}

/** One policy-authorized hop; credentials may narrow when its redirect changes origin. */
interface AuthorizedNetworkHop {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
}

/** Turn-scoped network module: policy, DNS pinning, redirects, timeout, and body limits. */
export class TurnNetworkClient {
  constructor(
    private readonly policy: ToolInvocationPolicy,
    private readonly signal: AbortSignal,
    private readonly transport: NetworkTransport = new NodeNetworkTransport(),
  ) {}

  async getText(url: string, options: NetworkRequestOptions = {}): Promise<NetworkTextResponse> {
    return this.#get(url, options, hop => this.transport.request(hop.url, hop.headers, hop.signal, hop.maxBytes));
  }

  async getBytes(url: string, options: NetworkRequestOptions = {}): Promise<NetworkBinaryResponse> {
    const request = this.transport.requestBytes;
    if (!request) throw new Error('This network transport does not support binary media');
    return this.#get(url, options, hop => request.call(this.transport, hop.url, hop.headers, hop.signal, hop.maxBytes));
  }

  async #get<T extends Omit<NetworkTextResponse, 'body' | 'url'> & { readonly body: string | Uint8Array }>(
    url: string,
    options: NetworkRequestOptions,
    request: (hop: AuthorizedNetworkHop) => Promise<T>,
  ): Promise<T & { readonly url: string }> {
    const maxRedirects = options.maxRedirects ?? 5;
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)]);
    let current = url;
    let headers = options.headers ?? {};

    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      signal.throwIfAborted();
      // A redirect target is chosen by the remote server, and a local policy refusal is not recorded
      // as provenance: its hostname or resolved address must not reach the model (#1250 第 56 批).
      const hop = async () => {
        const parsed = authorizeNetworkUrl(current, this.policy);
        return { parsed, response: await request({ url: parsed, headers, signal, maxBytes }) };
      };
      const { parsed, response } = redirect === 0 ? await hop() : await hop().catch((error: unknown) => {
        // Cancellation, the deadline and the body limit name no host: they pass through as they are.
        if (signal.aborted || error instanceof DOMException || (error instanceof Error && /exceeds \d+ bytes/u.test(error.message))) throw error;
        logger.debug(`redirect hop ${redirect} failed: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof NetworkAccessDeniedError) throw new NetworkAccessDeniedError(REDIRECT_DENIED_REASON);
        // DNS (ENOTFOUND), TLS altname and other transport errors quote the redirect target too.
        throw new Error(REDIRECT_FAILED_REASON);
      });
      if (response.status < 300 || response.status >= 400) {
        return Object.freeze({ url: parsed.href, ...response });
      }
      const location = response.headers.location;
      if (!location) return Object.freeze({ url: parsed.href, ...response });
      if (redirect === maxRedirects) {
        throw new NetworkAccessDeniedError(`Network redirect limit exceeded (${maxRedirects})`);
      }
      const next = new URL(location, parsed);
      if (next.origin !== parsed.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) =>
          !/^(?:authorization|cookie|proxy-authorization)$/iu.test(name)));
      }
      current = next.href;
    }
    throw new NetworkAccessDeniedError('Network redirect state is invalid');
  }
}

export function authorizeNetworkUrl(url: string, policy: ToolInvocationPolicy): URL {
  if (!policy.network.enabled) {
    throw new NetworkAccessDeniedError(NETWORK_DISABLED_REASON);
  }
  const decision = checkUrlNetworkAccess(url, {
    httpsOnly: policy.network.httpsOnly,
    allowedDomains: [...(policy.network.allowedDomains ?? [])],
  });
  if (!decision.allowed) throw new NetworkAccessDeniedError(decision.reason ?? 'Network target denied');
  return new URL(url);
}
