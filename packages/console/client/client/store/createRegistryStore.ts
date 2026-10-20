import * as React from "react";

export type RegistryStore<T> = {
  add(item: T): void;
  remove(predicate: (item: T) => boolean): void;
  getSnapshot(): readonly T[];
  subscribe(listener: () => void): () => void;
};

export function createRegistryStore<T>(dedupeKey?: (item: T) => string): RegistryStore<T> {
  let items: T[] = [];
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const l of listeners) l();
  };

  return {
    add(item) {
      if (dedupeKey) {
        const key = dedupeKey(item);
        if (items.some((i) => dedupeKey(i) === key)) return;
      }
      items = [...items, item];
      emit();
    },
    remove(predicate) {
      const next = items.filter((i) => !predicate(i));
      if (next.length !== items.length) {
        items = next;
        emit();
      }
    },
    getSnapshot() {
      return items;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useRegistry<T>(store: RegistryStore<T>): readonly T[] {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
