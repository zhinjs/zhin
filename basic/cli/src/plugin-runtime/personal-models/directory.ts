import { agentSessionSourceFields } from '@zhin.js/ai';
import type { StructuredDatabase } from '@zhin.js/database';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { personalSessionIdentity, personalSessionOwnerId, samePersonalSessionOwner,
  type PersonalSessionAddress, type PersonalSessionOwner } from '@zhin.js/agent/personal-session';
import { PersonalModelStateIntegrityError, PersonalModelStateUnavailableError } from './state.js';

export interface PersonalSessionDirectoryRow {
  readonly sessionKey: string;
  readonly address: PersonalSessionAddress;
  readonly updatedAt: number;
}
export interface PersonalSessionDirectoryPage {
  readonly rows: readonly PersonalSessionDirectoryRow[];
  readonly hasMore: boolean;
}
export type PersonalSessionDirectory = (
  owner: PersonalSessionOwner,
  page: Readonly<{ limit: number; offset: number }>,
) => Promise<PersonalSessionDirectoryPage>;

const COLUMNS = [
  'session_key', 'session_id', 'updated_at', 'source_root', 'source_platform', 'source_instance', 'source_subject',
  'source_kind', 'source_adapter', 'source_endpoint', 'source_scope', 'source_id',
  'source_parent_kind', 'source_parent_id', 'source_thread_id',
] as const;
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new PersonalModelStateIntegrityError();
  return value;
}
/** Inverse of agentSessionSourceFields' k1 encoding, including literal percent sequences. */
function decode(value: unknown): string {
  const encoded = text(value);
  if (!encoded.startsWith('k1:')) throw new PersonalModelStateIntegrityError();
  const decoded = encoded.slice(3).replace(/%(?:25|00)/gu, token => token === '%25' ? '%' : '\0');
  if (`k1:${decoded.replaceAll('%', '%25').replaceAll('\0', '%00')}` !== encoded) {
    throw new PersonalModelStateIntegrityError();
  }
  return decoded;
}
function kind(value: unknown): 'private' | 'group' | 'channel' {
  if (value !== 'private' && value !== 'group' && value !== 'channel') throw new PersonalModelStateIntegrityError();
  return value;
}
function metadata(row: Record<string, unknown>, owner: PersonalSessionOwner): PersonalSessionDirectoryRow {
  try {
    if (row.source_kind !== 'im') throw new PersonalModelStateIntegrityError();
    const parent = row.source_parent_kind == null && row.source_parent_id == null ? undefined
      : { kind: kind(row.source_parent_kind), id: decode(row.source_parent_id) };
    const identity = personalSessionIdentity({
      rootId: decode(row.source_root), platform: decode(row.source_platform), endpoint: decode(row.source_instance),
      subjectId: decode(row.source_subject),
      conversation: {
        endpoint: { adapter: decode(row.source_adapter), id: decode(row.source_endpoint) },
        kind: kind(row.source_scope), id: decode(row.source_id),
        ...(parent ? { parent } : {}),
        ...(row.source_thread_id == null ? {} : { threadId: decode(row.source_thread_id) }),
      },
    });
    if (!samePersonalSessionOwner(identity.owner, owner) || text(row.session_key) !== identity.key) {
      throw new PersonalModelStateIntegrityError();
    }
    const updatedAt = typeof row.updated_at === 'number' || typeof row.updated_at === 'bigint'
      || (typeof row.updated_at === 'string' && /^\d+$/u.test(row.updated_at)) ? Number(row.updated_at) : NaN;
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new PersonalModelStateIntegrityError();
    return Object.freeze({ sessionKey: identity.key, address: identity.address, updatedAt });
  } catch { throw new PersonalModelStateIntegrityError(); }
}

/** Current personal epochs only. Legacy/shared rows are never attributed to a person. */
export function createPersonalSessionDirectory(database: () => DatabaseHost | undefined): PersonalSessionDirectory {
  return async (owner, page) => {
    // The caller supplies an already authorized owner, never a client session key.
    personalSessionOwnerId(owner);
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit >= Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(page.offset) || page.offset < 0) throw new TypeError('Invalid personal Session page');
    const host = database();
    if (!host?.started || !['sqlite', 'mysql', 'pg'].includes(host.dialect)) throw new PersonalModelStateUnavailableError();
    // Root's real database query surface supports OFFSET. The smaller plugin model port does not.
    const raw = host.getRawDatabase() as Pick<StructuredDatabase, 'models'> | undefined;
    const model = raw?.models.get('agent_sessions');
    if (!model) throw new PersonalModelStateUnavailableError();
    const fields = agentSessionSourceFields({ kind: 'im', rootId: owner.rootId, platform: owner.platform,
      instance: owner.endpoint, subjectId: owner.subjectId, endpoint: owner.adapterId });
    const rows = await model.select(...COLUMNS).where({
      status: 'active', source_kind: 'im', source_root: fields.source_root, source_platform: fields.source_platform,
      source_instance: fields.source_instance, source_subject: fields.source_subject, source_endpoint: fields.source_endpoint,
    }).orderBy('updated_at', 'DESC').orderBy('session_id', 'DESC').limit(page.limit + 1).offset(page.offset);
    const checked = rows.map(row => metadata(row, owner));
    return Object.freeze({ rows: Object.freeze(checked.slice(0, page.limit)), hasMore: checked.length > page.limit });
  };
}
