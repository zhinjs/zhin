import { DisposeStack, type Dispose } from './dispose.js';
import { tokenId, type PluginId, type TokenId } from './identity.js';

export interface Token<T> {
  readonly id: TokenId;
  readonly description?: string;
  readonly _type?: () => T;
}

const rootPrivateTokens = new WeakSet<object>();

export function createToken<T>(id: string, description?: string): Token<T> {
  return Object.freeze({ id: tokenId(id), description });
}

export function createRootPrivateToken<T>(id: string, description?: string): Token<T> {
  const token: Token<T> = { id: tokenId(id), description };
  rootPrivateTokens.add(token);
  return Object.freeze(token);
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

export class Scope {
  readonly #bindings = new Map<TokenId, Binding>();
  #sealed = false;

  constructor(
    readonly owner: PluginId,
    readonly parent?: Scope,
    readonly disposers = new DisposeStack(),
  ) {}

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
    if (dispose) this.disposers.add(dispose);
  }

  use<T>(token: Token<T>): T {
    const binding = this.#bindings.get(token.id);
    if (binding) {
      if (!binding.rootPrivate || binding.token === token) return binding.value as T;
      throw new Error(`Missing resource ${token.id} for ${this.owner}`);
    }
    const inherited = this.parent
      ? this.parent.#resolveForDescendant(token.id)
      : undefined;
    if (inherited?.status === 'found') return inherited.binding.value as T;
    throw new Error(`Missing resource ${token.id} for ${this.owner}`);
  }

  has<T>(token: Token<T>): boolean {
    const binding = this.#bindings.get(token.id);
    if (binding) return !binding.rootPrivate || binding.token === token;
    return this.parent
      ? this.parent.#resolveForDescendant(token.id)?.status === 'found'
      : false;
  }

  seal(): void {
    this.#sealed = true;
    this.disposers.seal();
  }

  snapshot(): ReadonlyMap<TokenId, unknown> {
    if (!this.#sealed) throw new Error(`Scope is not sealed: ${this.owner}`);
    const result = this.parent
      ? new Map(this.parent.snapshot())
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
    return this.parent ? this.parent.#resolveForDescendant(id) : undefined;
  }
}
