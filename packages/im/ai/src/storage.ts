/**
 * StorageBackend — Unified storage abstraction layer
 *
 * Provides a common interface for AI sub-systems (session, context, memory,
 * user profile, follow-up) to switch between in-memory and database backends
 * without changing business logic.
 *
 * Usage:
 *   const backend = new MemoryStorageBackend<MyRecord>();
 *   // ... later, when DB is ready:
 *   const dbBackend = new DatabaseStorageBackend<MyRecord>(model, { keyField: 'session_id' });
 *   service.upgradeBackend(dbBackend);
 */

export interface StorageBackend<T extends Record<string, any>> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(filter?: Partial<T>): Promise<T[]>;
  clear(): Promise<void>;
  readonly type: 'memory' | 'database';
}

/**
 * In-memory storage backend.
 */
export class MemoryStorageBackend<T extends Record<string, any>> implements StorageBackend<T> {
  readonly type = 'memory' as const;
  private data = new Map<string, T>();

  async get(key: string): Promise<T | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const all = Array.from(this.data.values());
    if (!filter) return all;
    return all.filter(item => {
      for (const [k, v] of Object.entries(filter)) {
        if (item[k] !== v) return false;
      }
      return true;
    });
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

/**
 * Database model interface aligned with @zhin.js/database's RelatedModel API.
 */
export interface DbModel {
  select(...fields: string[]): any;
  create(data: Record<string, any>): Promise<any>;
  update(data: Partial<any>): any;
  delete(condition: Record<string, any>): any;
}

/**
 * Database-backed storage backend.
 */
export class DatabaseStorageBackend<T extends Record<string, any>> implements StorageBackend<T> {
  readonly type = 'database' as const;

  constructor(
    private model: DbModel,
    private options: {
      /** The field name used as lookup key (e.g. 'session_id', 'user_id') */
      keyField: string;
    },
  ) {}

  async get(key: string): Promise<T | null> {
    const rows: T[] = await this.model
      .select()
      .where({ [this.options.keyField]: key });
    return rows[0] ?? null;
  }

  async set(key: string, value: T): Promise<void> {
    const existing = await this.get(key);
    if (existing) {
      await this.model
        .update(value)
        .where({ [this.options.keyField]: key });
    } else {
      await this.model.create({ ...value, [this.options.keyField]: key });
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.model.delete({ [this.options.keyField]: key });
      return true;
    } catch {
      return false;
    }
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    if (filter) {
      return this.model.select().where(filter);
    }
    return this.model.select();
  }

  async clear(): Promise<void> {
    const all = await this.list();
    for (const item of all) {
      const key = (item as Record<string, unknown>)[this.options.keyField] as string | undefined;
      if (key) await this.delete(key);
    }
  }
}

/**
 * Helper to create a swappable backend ref.
 * Call `swap(newBackend)` to atomically upgrade from memory to database.
 */
export function createSwappableBackend<T extends Record<string, any>>(
  initial: StorageBackend<T>,
): { backend: StorageBackend<T>; swap: (next: StorageBackend<T>) => void } {
  const ref = { backend: initial, swap: (next: StorageBackend<T>) => { ref.backend = next; } };
  return ref;
}
