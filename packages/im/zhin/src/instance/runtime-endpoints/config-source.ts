import {
  AdapterManagementError,
  type EndpointConfigSource,
  type EndpointSecretResolver,
} from '@zhin.js/adapter';
import type { ConsoleConfigProjectPatchResult } from '@zhin.js/console-protocol';
import { readPluginConfigurationMap, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { isSecretConfigKey, parsePluginConfigSchema, type JsonSchema } from '@zhin.js/runtime';

/** Configuration file reads/writes the instance already owns (RuntimeConfigDocument + ConsoleConfigurationStore). */
export interface EndpointConfigSourceOptions {
  /** Stored (unexpanded) configuration document and its revision. */
  readonly read: () => Promise<Readonly<{ document: Readonly<Record<string, unknown>>; revision: string }>>;
  /** The current generation's snapshot (plugin tree: instance key and config schema per owner). */
  readonly snapshot: () => RuntimeSnapshot;
  /** Revision-checked, validated project write (`ConsoleConfigurationStore.patchProject`). */
  readonly patch: (request: Readonly<{ expectedRevision: string;
    patches: readonly Readonly<{ op: 'set'; path: readonly string[]; value: unknown }>[] }>) => Promise<ConsoleConfigProjectPatchResult>;
  /** Expands `${VAR}` against the current environment (missing → empty). */
  readonly expand: (value: string) => string;
}

function instanceOf(snapshot: RuntimeSnapshot, owner: PluginId): Readonly<{ instanceKey: string; schema?: JsonSchema }> | undefined {
  const node = snapshot.tree.get(owner);
  // Only top-level plugin instances have a `<instanceKey>:` block in the configuration file.
  if (!node || node.parent !== snapshot.root) return undefined;
  return { instanceKey: node.instanceKey, ...(node.configSchema ? { schema: node.configSchema as JsonSchema } : {}) };
}

/**
 * `zhin.config.yml` port of the Adapter accounts (#1250). Reads return the stored block with
 * schema defaults applied (so defaulted fields compare equal to the startup seed) and every
 * `${VAR}` left unexpanded; writes replace `<instance>.endpoints` through the Console
 * configuration store (revision CAS, schema validation, application).
 */
export function createEndpointConfigSource(options: EndpointConfigSourceOptions): EndpointConfigSource {
  return Object.freeze({
    async read(owner: PluginId, signal?: AbortSignal) {
      const { document, revision } = await options.read();
      signal?.throwIfAborted();
      const instance = instanceOf(options.snapshot(), owner);
      if (!instance) return Object.freeze({ config: undefined, revision });
      const stored = readPluginConfigurationMap(document)[instance.instanceKey];
      const block = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Readonly<Record<string, unknown>> : undefined;
      let config = block;
      if (instance.schema) {
        try {
          const parsed = parsePluginConfigSchema(instance.schema, block ?? {}).value;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as Readonly<Record<string, unknown>>;
        } catch { /* defaults are a comparison aid only */ }
      }
      return Object.freeze({ config, revision });
    },
    async writeEndpoints(owner: PluginId, endpoints: readonly Readonly<Record<string, unknown>>[], expectedRevision: string, signal?: AbortSignal) {
      const instance = instanceOf(options.snapshot(), owner);
      if (!instance) throw new AdapterManagementError('unsupported', 'This plugin instance has no configuration block');
      signal?.throwIfAborted();
      const result = await options.patch({ expectedRevision,
        patches: [{ op: 'set', path: [instance.instanceKey, 'endpoints'], value: structuredClone(endpoints) }] });
      if (result.status === 'saved') {
        return Object.freeze({ revision: result.revision, missingEnv: Object.freeze([...(result.missingEnv ?? [])]) });
      }
      if (result.status === 'conflict') throw new AdapterManagementError('conflict', 'The configuration file changed; reload before writing back');
      if (result.status === 'invalid') throw new AdapterManagementError('invalid_configuration', 'The written-back configuration does not validate');
      throw new AdapterManagementError('commit_unknown', 'Configuration save outcome is unconfirmed');
    },
    resolveIdentifier: (value: string) => options.expand(value),
    isSecretKey: (key: string) => isSecretConfigKey(key),
  });
}

/**
 * Resolves imported `${VAR}` account references at start (never stored resolved). A reference
 * that resolves to nothing is a configuration error, so the account waits for the operator
 * instead of retrying with an empty credential.
 */
export function createEndpointSecretResolver(expand: (value: string) => string): EndpointSecretResolver {
  return Object.freeze({
    async resolve(reference: string, context: Readonly<{ signal: AbortSignal }>) {
      context.signal.throwIfAborted();
      if (typeof reference !== 'string' || !reference.includes('${')) {
        throw new AdapterManagementError('invalid_configuration', 'Endpoint credential reference is invalid');
      }
      const value = expand(reference);
      if (!value) throw new AdapterManagementError('invalid_configuration', 'Endpoint credential reference resolves to an empty value');
      return value;
    },
  });
}
