import { AdapterManagementError, type EndpointDesiredRecord, type EndpointSecretResolver } from './adapter-types.js';
import { writeConfigurationPath } from './configuration-fields.js';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('adapter');

/**
 * #1250 b111: the platform's reason for a failed identity lookup, for the instance log (the Console
 * answer stays a fixed text). One bounded line; resolved credentials, URL query strings and
 * Authorization values are masked.
 */
export function identityFailureReason(cause: unknown, secrets: Iterable<string> = []): string {
  const raw = cause instanceof Error ? cause.message || cause.name : String(cause);
  let text = (raw.split(/\r?\n/u).find(line => line.trim()) ?? '').trim();
  for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join('***');
  text = text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, '$1***@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"`]*)[?#][^\s'"`]*/giu, '$1?***')
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;"']+/giu, '$1 ***');
  if (!text) return 'unknown';
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** Read-only verification; callers own CAS admission and account replacement. */
export async function sameConfigurationIdentity<Config>(input: {
  readonly previous: EndpointDesiredRecord;
  readonly next: Pick<EndpointDesiredRecord, 'config' | 'secretRefs'>;
  readonly changedFields: readonly string[];
  readonly signal: AbortSignal;
  readonly secrets?: EndpointSecretResolver;
  readonly identify: (config: Config, signal: AbortSignal, changedFields: readonly string[]) => Promise<string | undefined>;
}): Promise<boolean> {
  const { signal, changedFields, identify } = input;
  const resolvedSecrets = new Set<string>();
  const resolve = async (record: Pick<EndpointDesiredRecord, 'config' | 'secretRefs'>): Promise<Config> => {
    const config = structuredClone(record.config) as Record<string, unknown>;
    for (const [field, reference] of Object.entries(record.secretRefs ?? {})) {
      if (!input.secrets) throw new AdapterManagementError('unavailable', 'Endpoint secret resolver is unavailable');
      const value = await input.secrets.resolve(reference, { instanceId: input.previous.instanceId, signal });
      if (typeof value === 'string') resolvedSecrets.add(value);
      writeConfigurationPath(config, field, value);
      signal.throwIfAborted();
    }
    return config as Config;
  };
  signal.throwIfAborted();
  let previous: string | undefined, next: string | undefined;
  try {
    previous = await identify(await resolve(input.previous), signal, changedFields);
    signal.throwIfAborted();
    if (previous !== undefined) next = await identify(await resolve(input.next), signal, changedFields);
  } catch (cause) {
    signal.throwIfAborted();
    logger.warn(formatCompact({ op: 'endpoint_identity_verification_failed', endpoint: input.previous.endpointId,
      reason: identityFailureReason(cause, resolvedSecrets) }));
    throw new AdapterManagementError('unavailable', 'Account identity verification failed; configuration was not saved', { cause });
  }
  signal.throwIfAborted();
  if (previous === undefined || next === undefined) {
    throw new AdapterManagementError('unsupported', 'Identity cannot be verified; use explicit account replacement');
  }
  return previous === next;
}
