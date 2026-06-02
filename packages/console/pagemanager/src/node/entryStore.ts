import type { ConsoleEntry } from "@zhin.js/contract";

export type EntryStore = {
  add(entry: ConsoleEntry): void;
  list(): ConsoleEntry[];
};

export function createInMemoryEntryStore(): EntryStore {
  const entries: ConsoleEntry[] = [];
  return {
    add(entry) {
      entries.push(entry);
    },
    list() {
      return [...entries];
    },
  };
}
