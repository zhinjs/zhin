import type { CredentialGrant, ProviderDiscoveryOptions, ProviderModelObservation } from '../provider/driver.js';
import type { StandardServiceOptions } from './schema.js';

interface CatalogueProtocol {
  readonly endpoint: string;
  /** `codex`: the ChatGPT Codex backend catalogue (`{ models: [{ slug, display_name, visibility }] }`). */
  readonly format: 'openai' | 'anthropic' | 'google' | 'codex';
  readonly bearer?: boolean;
  readonly anonymous?: boolean;
  /** Driver routing headers derived from the grant (never the token itself). */
  readonly headers?: (grant: CredentialGrant) => Readonly<Record<string, string>>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Provider model catalogue');
  return value as Record<string, unknown>;
}

/** Explicit, read-only discovery. Observations do not confer model capabilities. */
export async function discoverModels(input: ProviderDiscoveryOptions<StandardServiceOptions>, protocol: CatalogueProtocol): Promise<readonly ProviderModelObservation[]> {
  let target = new URL(protocol.endpoint);
  const callRequests = new Set<Request>();
  const seen = new Set<string>(), observations = new Map<string, ProviderModelObservation>();
  for (;;) {
    input.signal.throwIfAborted();
    const grant = await input.credentials.authorize({ target, signal: input.signal });
    if (!grant.token && !protocol.anonymous) throw new Error('Provider account is not authorized');
    const headers = new Headers({ ...input.service.options.headers, ...grant.headers, ...protocol.headers?.(grant), accept: 'application/json' });
    if (grant.token) {
      const scheme = input.service.options.authScheme;
      const native = protocol.bearer || scheme !== undefined ? undefined : protocol.format === 'google' ? 'x-goog-api-key'
        : protocol.format === 'anthropic' ? 'x-api-key' : undefined;
      headers.set(native ?? 'authorization', native ? grant.token : scheme !== undefined ? [scheme, grant.token].filter(Boolean).join(' ') : `Bearer ${grant.token}`);
    }
    if (protocol.format === 'anthropic') headers.set('anthropic-version', '2023-06-01');
    const preparedRequest = new Request(target, { headers, signal: input.signal });
    const request = input.credentials.bindRequest({ grant, request: preparedRequest });
    callRequests.add(preparedRequest); callRequests.add(request);
    let body: Record<string, unknown>;
    try {
      const response = await input.fetch(request);
      if (!response.ok) throw new Error(`Provider model discovery rejected (${response.status})`);
      body = record(await response.json());
    } finally { callRequests.delete(preparedRequest); callRequests.delete(request); }
    const items = body[protocol.format === 'google' || protocol.format === 'codex' ? 'models' : 'data'];
    if (!Array.isArray(items)) throw new Error('Invalid Provider model catalogue');
    for (const item of items) {
      const value = record(item);
      // Codex marks picker-hidden entries with visibility `hide` / `none`; only listed models are offered.
      if (protocol.format === 'codex' && value.visibility !== undefined && value.visibility !== 'list') continue;
      const name = value[protocol.format === 'google' ? 'name' : protocol.format === 'codex' ? 'slug' : 'id'];
      if (typeof name !== 'string' || !name) throw new Error('Invalid Provider model catalogue');
      // Google's Models API returns a resource name, while its SDK accepts the
      // native model id and supplies the fixed `models/` path prefix itself.
      const id = protocol.format === 'google' && name.startsWith('models/') ? name.slice('models/'.length) : name;
      if (!id) throw new Error('Invalid Provider model catalogue');
      const label = value[protocol.format === 'google' ? 'displayName' : protocol.format === 'anthropic' || protocol.format === 'codex' ? 'display_name' : 'name'];
      observations.set(id, Object.freeze({ id, ...(typeof label === 'string' && label ? { label } : {}) }));
    }
    const cursor = protocol.format === 'google' ? body.nextPageToken
      : protocol.format === 'anthropic' && body.has_more === true ? body.last_id : undefined;
    if (cursor === undefined || cursor === null || cursor === '') return Object.freeze([...observations.values()]);
    if (typeof cursor !== 'string' || seen.has(cursor)) throw new Error('Invalid Provider catalogue pagination');
    seen.add(cursor);
    target = new URL(target);
    target.searchParams.set(protocol.format === 'google' ? 'pageToken' : 'after_id', cursor);
  }
}
