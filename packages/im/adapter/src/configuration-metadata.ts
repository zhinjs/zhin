/** Public account metadata must not reveal authentication carried inside a URL. */
const AUTH_QUERY_NAMES = new Set([
  'key', 'apikey', 'xapikey', 'apisecret', 'apitoken', 'accesskey', 'secretkey', 'secretaccesskey',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'auth', 'authorization',
  'password', 'passwd', 'secret', 'clientsecret', 'credential', 'credentials', 'privatekey',
  'signature', 'sig', 'oauthtoken', 'oauthtokensecret', 'xamzcredential', 'xamzsignature',
  'xgoogcredential', 'xgoogsignature',
]);

/** Presentation only: never normalize or rewrite the stored/transport URL. */
export function redactConfigurationUrl(field: string, value: string): string {
  const name = field.split('.').at(-1)?.replace(/[-_]/gu, '').toLowerCase() ?? '';
  // These are URL fields in the platform specs; route paths and free text are not URLs.
  if (!name.endsWith('url') && name !== 'signapiaddr') return value;
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (url.username || url.password) return '••••••';
  const parameters = [url.searchParams, new URLSearchParams(url.hash.slice(1).replace(/^\?/u, ''))];
  for (const group of parameters) for (const name of group.keys()) {
    if (AUTH_QUERY_NAMES.has(name.replace(/[-_]/gu, '').toLowerCase())) return '••••••';
  }
  return value;
}
