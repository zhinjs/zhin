/** SDK can reject start() with undefined; never pass raw URL-bearing SDK errors to logs. */
export function slackSocketConnectionError(value: unknown): Error {
  const proxyReason = 'Slack Stream proxy gateway identity changed; update fixed upstream before retrying';
  const source = value && typeof value === 'object' ? value as { message?: unknown; code?: unknown; original?: { message?: unknown; code?: unknown } } : undefined;
  if (source?.message === proxyReason || source?.original?.message === proxyReason) {
    return new Error('Slack Socket Mode gateway identity changed; fault proxy refused the connection');
  }
  const code = source?.original?.code ?? source?.code;
  const safeCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
  if (typeof code === 'string' && safeCodes.includes(code)) return new Error(`Slack Socket Mode connection failed (${code})`);
  return new Error('Slack Socket Mode connection failed; SDK did not confirm a connection');
}
