import { AdapterIdentityUnsupportedError, AdapterManagementError, type ConfigurationIdentityContext, type EndpointDesiredRecord, type EndpointSecretResolver } from './adapter-types.js';
import { writeConfigurationPath } from './configuration-fields.js';
import { formatCompact, getLogger, redactSecretText } from '@zhin.js/logger';

const logger = getLogger('adapter');

/**
 * #1250 b111: the platform's reason for a failed identity lookup, for the instance log (the Console
 * answer stays a fixed text). One bounded line. Masked first, then cut (a secret across the cut is
 * not half kept): the given credential values, secret-shaped text (`redactSecretText`: `token=…`,
 * JSON secret fields, Authorization headers, PEM blocks, …), URL query strings and user info.
 */
export function identityFailureReason(cause: unknown, secrets: Iterable<string> = []): string {
  let text = cause instanceof Error ? cause.message || cause.name : String(cause);
  // Longest first, so a value that contains another one is masked whole.
  for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 4) text = text.split(secret).join('***');
  }
  text = redactSecretText(text);
  text = (text.split(/\r?\n/u).find(line => line.trim()) ?? '').trim()
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, '$1***@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"`]*)[?#][^\s'"`]*/giu, '$1?***')
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;"']+/giu, '$1 ***');
  if (!text) return 'unknown';
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** Shortest configuration string treated as a possible credential when nothing marks it as one. */
const MIN_CONFIG_SECRET_LENGTH = 8;

/**
 * Values to mask in a failure reason (#1250 b111): every string of a probe field (the fields the
 * lookup reads), and every other configuration string of {@link MIN_CONFIG_SECRET_LENGTH} or more
 * characters. A credential typed in the Console is stored in the configuration as plain text (no
 * secret reference), and this layer cannot tell a credential field from another, so all are masked.
 */
function configurationStrings(config: unknown, probeFields: readonly string[], into: Set<string>): void {
  const visit = (value: unknown, path: string, depth: number): void => {
    if (typeof value === 'string') {
      const probe = probeFields.some(field => path === field || path.startsWith(`${field}.`));
      if (value.length >= (probe ? 4 : MIN_CONFIG_SECRET_LENGTH)) into.add(value);
    } else if (value && typeof value === 'object' && depth < 8) {
      for (const [key, item] of Object.entries(value)) visit(item, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  visit(config, '', 0);
}

/** Read-only verification; callers own CAS admission and account replacement. */
export async function sameConfigurationIdentity<Config>(input: {
  readonly previous: EndpointDesiredRecord;
  readonly next: Pick<EndpointDesiredRecord, 'config' | 'secretRefs'>;
  readonly changedFields: readonly string[];
  readonly signal: AbortSignal;
  readonly secrets?: EndpointSecretResolver;
  /** Called with `role: 'previous'` for the saved configuration, then `role: 'next'` for the proposed one. */
  readonly identify: (config: Config, signal: AbortSignal, changedFields: readonly string[],
    context: ConfigurationIdentityContext) => Promise<string | undefined>;
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
    // The saved credentials may already be revoked (the reason to rotate): `previous` lets a platform answer offline.
    previous = await identify(await resolve(input.previous), signal, changedFields, { role: 'previous' });
    signal.throwIfAborted();
    if (previous !== undefined) next = await identify(await resolve(input.next), signal, changedFields, { role: 'next' });
  } catch (cause) {
    signal.throwIfAborted();
    // A platform that knows it cannot verify this change says so itself (#1250 b115): keep its reason.
    // A brand check, not `instanceof`: the platform may have loaded another copy of this package.
    if (AdapterIdentityUnsupportedError.is(cause)) throw cause;
    const masked = new Set(resolvedSecrets);
    configurationStrings(input.previous.config, changedFields, masked);
    configurationStrings(input.next.config, changedFields, masked);
    logger.warn(formatCompact({ op: 'endpoint_identity_verification_failed', endpoint: input.previous.endpointId,
      reason: identityFailureReason(cause, masked) }));
    throw new AdapterManagementError('unavailable', 'Account identity verification failed; configuration was not saved', { cause });
  }
  signal.throwIfAborted();
  if (previous === undefined || next === undefined) {
    throw new AdapterManagementError('unsupported', 'Identity cannot be verified; use explicit account replacement');
  }
  return previous === next;
}
