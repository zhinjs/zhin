import { DisposeStack, type Dispose } from './dispose.js';

/**
 * Minimal structural view of a plugin setup context: anything owning a
 * generation-scoped lifecycle (e.g. PluginSetupContext) can provide values.
 */
export interface GenerationStoreContext {
  readonly lifecycle: DisposeStack;
}

export interface GenerationStore<T> {
  /**
   * Publish `value` as the current generation's value. The registration is
   * removed automatically when `context.lifecycle` disposes (generation end);
   * the returned Dispose unregisters manually and is idempotent.
   */
  provide(context: GenerationStoreContext, value: T): Dispose;
  /** Latest live value; throws a store-named error when none was provided. */
  use(): T;
  /** Latest live value, or `undefined` when none was provided. */
  tryUse(): T | undefined;
  /** Drop every registration across all generations. Mainly for tests. */
  clear(): void;
}

interface Registration<T> {
  readonly value: T;
}

/**
 * Generation-scoped replacement for module-level `let _x` singletons.
 *
 * Provided values form a stack: the newest live registration wins, and when a
 * generation ends its registration is removed via `context.lifecycle`,
 * re-exposing the previous generation's value. This structurally prevents
 * stale references to an already disposed generation (the repeater singleton
 * / rss `_db` class of bugs).
 */
export function createGenerationStore<T>(name: string): GenerationStore<T> {
  const registrations: Registration<T>[] = [];
  const unregister = (registration: Registration<T>): void => {
    const index = registrations.lastIndexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
  return {
    provide(context, value) {
      const registration: Registration<T> = Object.freeze({ value });
      registrations.push(registration);
      context.lifecycle.add(() => unregister(registration));
      return () => unregister(registration);
    },
    use() {
      const latest = registrations[registrations.length - 1];
      if (!latest) {
        throw new Error(
          `Generation store "${name}" has no live value — call provide(context, value) during plugin setup`,
        );
      }
      return latest.value;
    },
    tryUse() {
      return registrations[registrations.length - 1]?.value;
    },
    clear() {
      registrations.length = 0;
    },
  };
}
