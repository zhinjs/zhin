import type { ReadinessReport } from './readiness.js';

/** Used by doctor and automation; token stays in an environment variable, not argv. */
export async function fetchReadiness(host: string, token = process.env.ZHIN_HTTP_TOKEN): Promise<ReadinessReport> {
  const url = new URL(host);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) Host URL without credentials, query or fragment.');
  }
  const base = url.pathname.replace(/\/$/u, '');
  url.pathname = `${base || '/api'}/system/readiness`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Readiness requires a full-scope Host token in ZHIN_HTTP_TOKEN.');
  }
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Host readiness request failed (HTTP ${response.status}).`);
  }
  const body = await response.json() as { data?: ReadinessReport };
  if (typeof body.data?.ready !== 'boolean' || !Array.isArray(body.data.checks)
    || typeof body.data.checkedAt !== 'string'
    || body.data.checks.some((check) => !check || typeof check.component !== 'string'
      || typeof check.ready !== 'boolean' || typeof check.reason !== 'string')
    || body.data.ready !== (response.status === 200)) {
    throw new Error('Host returned an invalid readiness report.');
  }
  return body.data;
}
