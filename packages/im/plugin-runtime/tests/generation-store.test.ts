import { describe, expect, it } from 'vitest';
import { createGenerationStore, DisposeStack } from '../src/index.js';

describe('generation store', () => {
  it('throws a store-named error from use() and returns undefined from tryUse() when empty', () => {
    const store = createGenerationStore<string>('demo/deps');

    expect(store.tryUse()).toBeUndefined();
    expect(() => store.use()).toThrowError(/demo\/deps/);
  });

  it('returns the provided value from use() and tryUse()', () => {
    const store = createGenerationStore<{ id: number }>('demo/deps');
    const lifecycle = new DisposeStack();
    const value = { id: 1 };

    store.provide({ lifecycle }, value);

    expect(store.use()).toBe(value);
    expect(store.tryUse()).toBe(value);
  });

  it('unregisters automatically when the generation lifecycle disposes', async () => {
    const store = createGenerationStore<string>('demo/deps');
    const lifecycle = new DisposeStack();

    store.provide({ lifecycle }, 'gen-0');
    expect(store.use()).toBe('gen-0');

    await lifecycle.dispose();

    expect(store.tryUse()).toBeUndefined();
    expect(() => store.use()).toThrowError(/demo\/deps/);
  });

  it('keeps the newest generation and re-exposes the previous one when it ends', async () => {
    const store = createGenerationStore<string>('demo/deps');
    const previousLifecycle = new DisposeStack();
    const nextLifecycle = new DisposeStack();

    store.provide({ lifecycle: previousLifecycle }, 'gen-0');
    store.provide({ lifecycle: nextLifecycle }, 'gen-1');
    expect(store.use()).toBe('gen-1');

    // Older generation disposing first must not shadow the newer value.
    await previousLifecycle.dispose();
    expect(store.use()).toBe('gen-1');

    await nextLifecycle.dispose();
    expect(store.tryUse()).toBeUndefined();
  });

  it('supports manual unregister via the returned dispose, idempotently', () => {
    const store = createGenerationStore<string>('demo/deps');
    const lifecycle = new DisposeStack();

    const dispose = store.provide({ lifecycle }, 'gen-0');
    expect(store.use()).toBe('gen-0');

    dispose();
    dispose();
    expect(store.tryUse()).toBeUndefined();
  });

  it('clear() drops registrations across all generations', () => {
    const store = createGenerationStore<string>('demo/deps');
    store.provide({ lifecycle: new DisposeStack() }, 'gen-0');
    store.provide({ lifecycle: new DisposeStack() }, 'gen-1');

    store.clear();

    expect(store.tryUse()).toBeUndefined();
    expect(() => store.use()).toThrowError(/demo\/deps/);
  });

  it('keeps provided values readable as null without confusing absence', () => {
    const store = createGenerationStore<string | null>('demo/deps');
    store.provide({ lifecycle: new DisposeStack() }, null);

    expect(store.use()).toBeNull();
    expect(store.tryUse()).toBeNull();
  });
});
