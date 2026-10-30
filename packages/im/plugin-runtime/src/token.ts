import { DisposeStack, type Dispose } from './dispose.js';
import { tokenId, type FeatureId, type PluginId, type TokenId } from './identity.js';

export interface Token<T> {
  readonly id: TokenId;
  readonly description?: string;
  readonly _type?: () => T;
}

const rootPrivateTokens = new WeakSet<object>();
const featurePrivateTokens = new WeakMap<object, FeatureId>();

export function createToken<T>(id: string, description?: string): Token<T> {
  return Object.freeze({ id: tokenId(id), description });
}

export function createRootPrivateToken<T>(id: string, description?: string): Token<T> {
  const token: Token<T> = { id: tokenId(id), description };
  rootPrivateTokens.add(token);
  return Object.freeze(token);
}

/** A Root-private capability readable only while projecting its owning Feature. */
export function createFeaturePrivateToken<T>(id: string, feature: FeatureId, description?: string): Token<T> {
  const token = createRootPrivateToken<T>(id, description);
  featurePrivateTokens.set(token, feature);
  return token;
}

/** @internal The actual candidate Root Scope never enters the Feature context. */
export function readFeaturePrivateResource<T>(scope: Pick<Scope, 'has' | 'use'>, feature: FeatureId, token: Token<T>): T | undefined {
  if (featurePrivateTokens.get(token) !== feature) throw new Error(`Feature cannot access Root resource ${token.id}`);
  return scope.has(token) ? scope.use(token) : undefined;
}

interface Binding<T = unknown> {
  readonly owner: PluginId;
  readonly value: T;
  readonly rootPrivate: boolean;
  readonly token: object;
}

type InheritedBinding = Readonly<{ status: 'found'; binding: Binding }>
  | Readonly<{ status: 'blocked' }>
  | undefined;

/** @internal Ends a facade's candidate declarations on seal or failed setup disposal. */
export const scopeSetupFinalizer: unique symbol = Symbol('ScopeSetupFinalizer');

export class Scope {
  readonly #bindings = new Map<TokenId, Binding>();
  readonly #parent?: Scope;
  readonly #setupFinalizers = new Set<(reason: 'seal' | 'dispose') => void>();
  #sealed = false;

  constructor(
    readonly owner: PluginId,
    parent?: Scope,
    readonly disposers = new DisposeStack(),
  ) { this.#parent = parent; }

  provide<T>(token: Token<T>, value: T, dispose?: Dispose): void {
    if (this.#sealed) throw new Error(`Scope is sealed: ${this.owner}`);
    if (this.#bindings.has(token.id)) {
      throw new Error(`Duplicate resource ${token.id} in ${this.owner}`);
    }
    this.#bindings.set(token.id, Object.freeze({
      owner: this.owner,
      value,
      rootPrivate: rootPrivateTokens.has(token),
      token,
    }));
    if (value && typeof value === 'object') {
      const finalize = (value as { [scopeSetupFinalizer]?: (reason: 'seal' | 'dispose') => void })[scopeSetupFinalizer];
      if (typeof finalize === 'function') {
        const endSetup = (reason: 'seal' | 'dispose') => finalize.call(value, reason);
        this.#setupFinalizers.add(endSetup);
        this.disposers.add(() => endSetup('dispose'));
      }
    }
    if (dispose) this.disposers.add(dispose);
  }

  use<T>(token: Token<T>): T {
    const binding = this.#bindings.get(token.id);
    if (binding) {
      if (!binding.rootPrivate || binding.token === token) return binding.value as T;
      throw new Error(`Missing resource ${token.id} for ${this.owner}`);
    }
    const inherited = this.#parent
      ? this.#parent.#resolveForDescendant(token.id)
      : undefined;
    if (inherited?.status === 'found') return inherited.binding.value as T;
    throw new Error(`Missing resource ${token.id} for ${this.owner}`);
  }

  has<T>(token: Token<T>): boolean {
    const binding = this.#bindings.get(token.id);
    if (binding) return !binding.rootPrivate || binding.token === token;
    return this.#parent
      ? this.#parent.#resolveForDescendant(token.id)?.status === 'found'
      : false;
  }

  seal(): void {
    this.#sealed = true;
    for (const finalize of this.#setupFinalizers) finalize('seal');
    this.#setupFinalizers.clear();
    this.disposers.seal();
  }

  snapshot(): ReadonlyMap<TokenId, unknown> {
    if (!this.#sealed) throw new Error(`Scope is not sealed: ${this.owner}`);
    const result = this.#parent
      ? new Map(this.#parent.snapshot())
      : new Map<TokenId, unknown>();
    for (const [id, binding] of this.#bindings) {
      if (!binding.rootPrivate) result.set(id, binding.value);
    }
    return result;
  }

  #resolveForDescendant(id: TokenId): InheritedBinding {
    const binding = this.#bindings.get(id);
    if (binding) {
      return binding.rootPrivate
        ? Object.freeze({ status: 'blocked' as const })
        : Object.freeze({ status: 'found' as const, binding });
    }
    return this.#parent ? this.#parent.#resolveForDescendant(id) : undefined;
  }
}
