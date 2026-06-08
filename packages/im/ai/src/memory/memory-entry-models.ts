/**
 * Semantic memory entries — L4 structured recall (no vector v1).
 */

export type MemoryEntryScope = 'global' | 'platform' | 'session' | 'user';

export const MEMORY_ENTRY_MODEL = {
  id: { type: 'text' as const, nullable: false },
  scope: { type: 'text' as const, nullable: false },
  scope_key: { type: 'text' as const, default: '' },
  key: { type: 'text' as const, nullable: false },
  content: { type: 'text' as const, nullable: false },
  tags: { type: 'text' as const, default: '[]' },
  source: { type: 'text' as const, default: '' },
  confidence: { type: 'real' as const, default: 1 },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
  expires_at: { type: 'integer' as const, nullable: true },
};

export interface MemoryEntryRecord {
  id: string;
  scope: MemoryEntryScope;
  scope_key: string;
  key: string;
  content: string;
  tags: string;
  source: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

export interface MemoryEntryUpsertInput {
  scope: MemoryEntryScope;
  scope_key?: string;
  key: string;
  content: string;
  tags?: string[];
  source?: string;
  confidence?: number;
  expires_at?: number | null;
}

export interface MemoryEntrySearchInput {
  scope?: MemoryEntryScope;
  scope_key?: string;
  query: string;
  limit?: number;
}

export function parseMemoryTags(json: string): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serializeMemoryTags(tags: string[] | undefined): string {
  return JSON.stringify(tags ?? []);
}
