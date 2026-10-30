import { ModelCatalogError, normalizeModelCatalogConfig, type CatalogModel, type ModelCatalogConfig, type ModelConnection, type ModelPreset } from '@zhin.js/ai/model-catalog';
import { ModelRuntimeError } from './types.js';

/** Host file authoring only; personal and generic catalogs retain their complete identity contract. */
export interface HostModelCatalogConfig {
  readonly connections: Readonly<Record<string, Omit<ModelConnection, 'id' | 'ownerId'> & { readonly id?: string; readonly ownerId?: string }>>;
  readonly models: Readonly<Record<string, Omit<CatalogModel, 'id'> & { readonly id?: string }>>;
  readonly presets: Readonly<Record<string, Omit<ModelPreset, 'id'> & { readonly id?: string }>>;
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ModelCatalogError('invalid-config');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new ModelCatalogError('invalid-config');
  return input as Record<string, unknown>;
}

function ownFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Reflect.ownKeys(value).map(key => [key, Reflect.get(value, key)]));
}

/** Completes only redundant Host identities, then delegates all validation to the strict catalog. */
export function normalizeHostModelCatalog(input: unknown, hostOwnerId: string): ModelCatalogConfig {
  if (typeof hostOwnerId !== 'string' || !hostOwnerId || hostOwnerId !== hostOwnerId.trim()) throw new ModelRuntimeError('invalid-config');
  const raw = object(input);
  const complete = (input: unknown, connection = false): Record<string, unknown> => {
    const entries = object(input);
    if (Reflect.ownKeys(entries).some(key => typeof key !== 'string')) throw new ModelCatalogError('invalid-config');
    return Object.fromEntries(Object.entries(entries).map(([key, input]) => {
      const entry = object(input);
      return [key, { ...ownFields(entry), id: entry.id === undefined ? key : entry.id,
        ...(connection ? { ownerId: entry.ownerId === undefined ? hostOwnerId : entry.ownerId } : {}) }];
    }));
  };
  const catalog = normalizeModelCatalogConfig({ ...ownFields(raw),
    connections: complete(raw.connections, true), models: complete(raw.models), presets: complete(raw.presets),
  });
  if (Object.values(catalog.connections).some(connection => connection.ownerId !== hostOwnerId)) throw new ModelRuntimeError('deployment-owner-mismatch');
  return catalog;
}
