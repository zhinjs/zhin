/**
 * ADR 0066 D2: a decision driver's failure must be classifiable, so the interjection judge chain can
 * decide whether to switch to the next model and whether to mark this one in the skip table.
 */
import { classifyFallbackFailure, classifyProviderError, ProviderRequestError } from '../../src/index.js';

describe('decision driver errors (ADR 0066 D2)', () => {
  it('classifies an unusable answer reported as code invalid-response', () => {
    expect(classifyProviderError(Object.assign(new Error('decision invalid-response'), { code: 'invalid-response' }))).toEqual({ kind: 'invalid_response', retryable: false });
    expect(classifyProviderError(Object.assign(new Error('x'), { code: 'invalid_response', status: 200 }))).toMatchObject({ kind: 'invalid_response', status: 200 });
  });

  it('reads status, Retry-After and body codes of a driver error', () => {
    const headers = new Headers({ 'retry-after': '12' });
    expect(classifyProviderError(Object.assign(new Error('decision request-failed (HTTP 429)'), { status: 429, responseHeaders: headers }))).toMatchObject({ kind: 'rate_limit', retryAfterMs: 12_000 });
    expect(classifyProviderError(Object.assign(new Error('decision request-failed (HTTP 429)'), { status: 429, responseBody: JSON.stringify({ error: { code: 'insufficient_quota' } }) }))).toMatchObject({ kind: 'billing' });
    expect(classifyProviderError(Object.assign(new Error('Too many requests: requests per day (RPD) exceeded'), { status: 429 }))).toMatchObject({ kind: 'quota_exhausted', quotaWindow: 'day' });
    expect(classifyProviderError(Object.assign(new Error('decision request-failed (network)'), {}))).toMatchObject({ kind: 'network' });
  });

  it('classifyFallbackFailure keeps the resilience kind with the provider hints underneath', () => {
    const cause = Object.assign(new Error('quota'), { status: 429, responseHeaders: new Headers({ 'retry-after': '5' }) });
    expect(classifyFallbackFailure(new ProviderRequestError('quota_exhausted', 1, cause))).toMatchObject({ kind: 'quota_exhausted', retryAfterMs: 5_000 });
  });
});
