/** Owner-scoped HTTP transport for AI SDK and direct provider requests. */
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export interface AiHttpTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly proxyUrl?: string;
}

export function resolveAiProxyUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return env.HTTPS_PROXY?.trim()
    || env.https_proxy?.trim()
    || env.HTTP_PROXY?.trim()
    || env.http_proxy?.trim()
    || undefined;
}

export class AiHttpTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly #proxyAgent?: ProxyAgent;

  constructor(options: AiHttpTransportOptions = {}) {
    const proxyUrl = options.proxyUrl?.trim();
    if (!proxyUrl) {
      this.fetch = options.fetch ?? globalThis.fetch;
      return;
    }

    const proxyAgent = new ProxyAgent(proxyUrl);
    this.#proxyAgent = proxyAgent;
    this.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher: proxyAgent,
      })) as unknown as typeof globalThis.fetch;
  }

  async dispose(): Promise<void> {
    await this.#proxyAgent?.close();
  }
}

export function createAiHttpTransport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AiHttpTransport {
  return new AiHttpTransport({ proxyUrl: resolveAiProxyUrl(env) });
}
