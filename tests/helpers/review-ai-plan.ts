import { createEmptyProviderGraph, normalizeProviderJson, reviewProviderPlan, type JsonObject, type ProviderDefinition } from '../../packages/im/ai/src/provider/index.js';
import { builtinAiProviders } from '../../packages/im/ai/src/providers/index.js';
import { expandEnvironmentValue } from '../../packages/im/runtime/src/environment-store.js';

/** Real offline review of authored examples; no credential resolver or transport is installed. */
export function reviewAIPlan(input: unknown) {
  const definitions: readonly ProviderDefinition<unknown, unknown>[] = builtinAiProviders;
  const driver = (id: string) => {
    const definition = definitions.find(value => value.id === id);
    if (!definition) throw new Error(`Unknown explicit example Driver: ${id}`);
    return definition;
  };
  const json = (value: unknown): JsonObject => {
    const parsed = normalizeProviderJson(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
    return parsed as JsonObject;
  };
  let sequence = 0;
  return reviewProviderPlan({ input, graph: createEmptyProviderGraph('example-root'), ownerId: 'host:example', hostOwnerId: 'host:example',
    createId: kind => `${kind}:${++sequence}`,
    resolveService: value => {
      const id = typeof value.driver === 'string' ? value.driver : value.driver.id;
      const definition = driver(id);
      const service = { id: 'reviewed-service', rootId: 'example-root', ownerId: 'host:example', revision: 1,
        driver: { id, owner: 'root', contractVersion: definition.contractVersion },
        options: json(definition.serviceSchema.parse(expandEnvironmentValue(value.options, () => undefined,
          name => { throw new Error(`Example needs an explicit value or default for ${name}`); }))), models: value.models };
      return { driver: service.driver, options: service.options, models: definition.models(service) };
    },
    validateProfile: ({ service, account, profile }) => {
      const definition = driver(service.driver.id);
      if (!definition.authentication.methods.includes(account.authentication.method)) throw new Error('Unsupported example authentication');
      return json(definition.profileSchema?.({ service, model: service.models[profile.model] }).parse(profile.parameters) ?? profile.parameters);
    },
  });
}
