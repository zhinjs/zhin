import { DisposeStack, type Dispose } from './dispose.js';
import { tokenId, type PluginId, type TokenId } from './identity.js';

export interface Token<T> {
  readonly id: TokenId;
  readonly description?: string;
  readonly _type?: () => T;
}

export function createToken<T>(id: string, description?: string): Token<T> {
  return Object.freeze({ id: tokenId(id), description });
}

interface Binding<T = unknown> {
  readonly owner: PluginId;
  readonly value: T;
}

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
    this.#bindings.set(token.id, Object.freeze({ owner: this.owner, value }));
    if (dispose) this.disposers.add(dispose);
  }

  use<T>(token: Token<T>): T {
    const binding = this.#bindings.get(token.id);
    if (binding) return binding.value as T;
    if (this.parent) return this.parent.use(token);
    throw new Error(`Missing resource ${token.id} for ${this.owner}`);
  }

  has<T>(token: Token<T>): boolean {
    return this.#bindings.has(token.id) || Boolean(this.parent?.has(token));
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
    for (const [id, binding] of this.#bindings) result.set(id, binding.value);
    return result;
  }
}
