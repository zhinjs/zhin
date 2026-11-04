import type { AIProviderRegistry } from './index.js';
import type { ProviderDefinition } from './driver.js';
import type { JsonObject, ModelDefinition } from './types.js';
import { normalizeProviderJson } from './graph.js';

type DriverName = Extract<keyof AIProviderRegistry, string>;
type DriverId<D> = D extends { id: infer N extends DriverName } ? N : D extends DriverName ? D : never;
type OptionsOf<N extends DriverName> = AIProviderRegistry[N] extends ProviderDefinition<infer S, infer _P> ? S : never;
type ParametersOf<N extends DriverName> = AIProviderRegistry[N] extends ProviderDefinition<infer _S, infer P> ? P : never;
type MethodsOf<N extends DriverName> = AIProviderRegistry[N] extends { authentication: { methods: readonly (infer M)[] } } ? M : never;
type AuthenticationInput<M> = M extends 'api-key'
  ? Readonly<{ method: M; source?: `env://${string}` }>
  : M extends 'oauth' | 'none' ? Readonly<{ method: M }> : never;
type RegisteredService = { [N in DriverName]: Readonly<{
  driver: N | Readonly<{ id: N; owner: string; contractVersion: string }>; options?: Partial<OptionsOf<N>>; models?: Readonly<Record<string, ModelDefinition>>; label?: string;
}> }[DriverName];
type Services = Readonly<Record<string, RegisteredService>>;
type AccountFor<S extends Services> = { [K in keyof S]: Readonly<{
  service: K; auth: AuthenticationInput<MethodsOf<DriverId<S[K]['driver']>>>; label?: string;
}> }[keyof S];
type Accounts<S extends Services> = Readonly<Record<string, AccountFor<S>>>;
type ProfileFor<S extends Services, A extends Accounts<S>> = { [K in keyof A]: Readonly<{
  account: K; model: string; parameters?: Partial<ParametersOf<DriverId<S[A[K]['service'] & keyof S]['driver']>>>; label?: string;
}> }[keyof A];
type ExactOptions<S extends Services> = { [K in keyof S]: S[K] extends { options: infer O }
  ? { options: O & Record<Exclude<keyof O, keyof OptionsOf<DriverId<S[K]['driver']>>>, never> } : unknown };

/** Static authoring aid. Driver declarations must be loaded; YAML remains runtime-validated.
 * Driver schema validation and exact capability ownership happen in import preview. */
export function defineAIPlan<
  const S extends Services,
  const A extends Accounts<S>,
  const P extends Readonly<Record<string, ProfileFor<S, A>>>,
>(input: Readonly<{
  version: 1;
  services: S & ExactOptions<S>;
  accounts: A;
  profiles: P;
  purposes?: JsonObject;
  remove?: Readonly<Partial<Record<'services' | 'accounts' | 'profiles', readonly string[]>>>;
}>): typeof input {
  return normalizeProviderJson(input) as unknown as typeof input;
}
