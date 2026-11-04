import { AdapterManagementError, type EndpointDesiredRecord, type EndpointSecretResolver } from './adapter-types.js';
import { writeConfigurationPath } from './configuration-fields.js';

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
  const resolve = async (record: Pick<EndpointDesiredRecord, 'config' | 'secretRefs'>): Promise<Config> => {
    const config = structuredClone(record.config) as Record<string, unknown>;
    for (const [field, reference] of Object.entries(record.secretRefs ?? {})) {
      if (!input.secrets) throw new AdapterManagementError('unavailable', 'Endpoint secret resolver is unavailable');
      writeConfigurationPath(config, field, await input.secrets.resolve(reference, { instanceId: input.previous.instanceId, signal }));
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
    throw new AdapterManagementError('unavailable', 'Account identity verification failed; configuration was not saved', { cause });
  }
  signal.throwIfAborted();
  if (previous === undefined || next === undefined) {
    throw new AdapterManagementError('unsupported', 'Identity cannot be verified; use explicit account replacement');
  }
  return previous === next;
}
