/**
 * Optional HTTP(S) proxy for AI SDK outbound requests.
 * Node fetch ignores HTTPS_PROXY; undici ProxyAgent bridges Clash/Surge etc.
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';

let cachedProxyUrl: string | undefined | null = null;
let cachedFetch: typeof globalThis.fetch | undefined;

function resolveProxyUrl(): string | undefined {
  if (cachedProxyUrl !== null) return cachedProxyUrl;
  const raw = process.env.HTTPS_PROXY?.trim()
    || process.env.https_proxy?.trim()
    || process.env.HTTP_PROXY?.trim()
    || process.env.http_proxy?.trim();
  cachedProxyUrl = raw || undefined;
  return cachedProxyUrl;
}

/** Custom fetch when HTTPS_PROXY / HTTP_PROXY is set; otherwise undefined (native fetch). */
export function resolveProxyFetch(): typeof globalThis.fetch | undefined {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) return undefined;
  if (!cachedFetch) {
    const agent = new ProxyAgent(proxyUrl);
    const proxied = (input: RequestInfo | URL, init?: RequestInit) =>
      undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher: agent,
      });
    cachedFetch = proxied as unknown as typeof globalThis.fetch;
  }
  return cachedFetch;
}
