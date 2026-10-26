import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { createToken } from 'zhin.js';

export const DEFAULT_API_BASE = 'https://60s.viki.moe';

export type SixtySApiBase = () => string | undefined;

/** Owner-scoped transport for one 60s plugin instance. */
export class SixtySClient {
  readonly #getApiBase: SixtySApiBase;

  constructor(getApiBase: SixtySApiBase) {
    this.#getApiBase = getApiBase;
  }

  get apiBase(): string {
    return this.#getApiBase()?.trim().replace(/\/$/u, '') || DEFAULT_API_BASE;
  }

  async fetch<T = Record<string, unknown>>(
    endpoint: string,
    params?: Readonly<Record<string, string>>,
    locale?: Locale,
  ): Promise<T> {
    const url = new URL(`${this.apiBase}/v2${endpoint}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      const cause = error as Error;
      throw new Error(
        cause.name === 'TimeoutError' ? t(locale, 'requestTimeout') : t(locale, 'requestFailed', { detail: cause.message }),
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(t(locale, 'httpError', { status: response.status, text: response.statusText }));
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(t(locale, 'jsonError', { type: contentType || 'unknown' }));
    }
    const envelope = (await response.json()) as {
      error?: string;
      code?: number;
      message?: string;
      msg?: string;
      data?: T;
    };
    if (envelope.error) throw new Error(envelope.error);
    if (envelope.code !== undefined && envelope.code !== 200 && envelope.code !== 0) {
      throw new Error(envelope.message || envelope.msg || t(locale, 'apiError', { code: envelope.code }));
    }
    return (envelope.data ?? envelope) as T;
  }
}

export const sixtySClientToken = createToken<SixtySClient>(
  'zhin.sixty-s.client',
  'Owner-scoped 60s API client',
);
