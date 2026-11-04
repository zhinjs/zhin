import type { ProviderErrorClassification } from './provider-resilience.js';

/** Safe provider failure evidence; never retains the remote payload, URL or original cause. */
export class ProviderResponseError extends Error {
  readonly classification: ProviderErrorClassification;
  readonly statusCode?: number;
  readonly isRetryable: boolean;
  readonly responseHeaders: Readonly<Record<string, string>>;
  constructor(classification: ProviderErrorClassification) {
    super(`Model service request failed (${classification.kind}${classification.status === undefined ? '' : `, HTTP ${classification.status}`})`);
    this.name = 'ProviderResponseError';
    this.classification = Object.freeze({ ...classification });
    this.statusCode = classification.status;
    this.isRetryable = classification.retryable;
    const headers: Record<string, string> = {};
    if (classification.retryAfterMs !== undefined) headers['retry-after-ms'] = String(classification.retryAfterMs);
    this.responseHeaders = Object.freeze(headers);
  }
}
