import { describe, expect, it, vi } from 'vitest';
import { agentSessionSourceFields } from '@zhin.js/ai';
import { personalSessionIdentity, type PersonalSessionAddress } from '@zhin.js/agent/personal-session';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { createPersonalSessionDirectory } from '../../../src/plugin-runtime/personal-models/directory.js';
import { PersonalModelStateIntegrityError, PersonalModelStateUnavailableError } from '../../../src/plugin-runtime/personal-models/state.js';

function address(): PersonalSessionAddress {
  return { rootId: '/host-a', platform: 'qq', endpoint: 'account-a', subjectId: 'alice',
    conversation: { endpoint: { adapter: 'root', id: 'root\0zhin.adapter\0qq' }, kind: 'channel', id: 'room%00',
      parent: { kind: 'group', id: 'guild' }, threadId: 'topic' } };
}
function row(input = address(), updatedAt = 100, epoch = 'epoch-a') {
  const identity = personalSessionIdentity(input);
  return { session_key: identity.key, session_id: epoch, updated_at: updatedAt, status: 'active',
    ...agentSessionSourceFields({ rootId: input.rootId, platform: input.platform, instance: input.endpoint, subjectId: input.subjectId,
      kind: 'im', adapter: input.conversation.endpoint.adapter, endpoint: input.conversation.endpoint.id,
      scope: input.conversation.kind, id: input.conversation.id,
      parentKind: input.conversation.parent?.kind, parentId: input.conversation.parent?.id, threadId: input.conversation.threadId }),
  };
}
function fixture(data: Record<string, unknown>[], options: { fail?: Error; ignoreWhere?: boolean } = {}) {
  const operations: Array<[string, unknown]> = [];
  const select = vi.fn((...fields: string[]) => {
    operations.push(['select', fields]);
    let where: Record<string, unknown> = {}; let limit = Infinity; let offset = 0;
    const ordering: Array<[string, 'ASC' | 'DESC']> = [];
    const selection = {
      where(value: Record<string, unknown>) { where = value; operations.push(['where', value]); return selection; },
      orderBy(field: string, direction: 'ASC' | 'DESC') { ordering.push([field, direction]); operations.push(['orderBy', [field, direction]]); return selection; },
      limit(value: number) { limit = value; operations.push(['limit', value]); return selection; },
      offset(value: number) { offset = value; operations.push(['offset', value]); return selection; },
      then(resolve: (value: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) {
        operations.push(['execute', null]);
        if (options.fail) return Promise.reject(options.fail).then(resolve, reject);
        const filtered = data.filter(row => options.ignoreWhere || Object.entries(where).every(([key, value]) => row[key] === value));
        filtered.sort((a, b) => {
          for (const [field, direction] of ordering) {
            const compared = a[field] === b[field] ? 0 : a[field]! < b[field]! ? -1 : 1;
            if (compared) return direction === 'ASC' ? compared : -compared;
          }
          return 0;
        });
        return Promise.resolve(filtered.slice(offset, offset + limit)).then(resolve, reject);
      },
    };
    return selection;
  });
  const host = { started: true, dialect: 'sqlite', getRawDatabase: () => ({ models: new Map([['agent_sessions', { select }]]) }) } as unknown as DatabaseHost;
  return { host, operations, select, directory: createPersonalSessionDirectory(() => host) };
}

describe('personal Session directory', () => {
  it('filters the complete authenticated owner in SQL before bounded stable pagination', async () => {
    const target = address(); const identity = personalSessionIdentity(target);
    const source = row(target);
    const data = [source,
      ...(['rootId', 'platform', 'endpoint', 'subjectId'] as const).map(field => row({ ...target, [field]: `${target[field]}-other` }, 1000)),
      row({ ...target, conversation: { ...target.conversation, endpoint: { ...target.conversation.endpoint, id: 'another-capability' } } }, 1000),
      { ...source, source_root: null, source_subject: null, session_key: 'qq:account-a:channel:room%00', updated_at: 1000 },
      { ...source, status: 'archived', updated_at: 1000 },
      row({ ...target, conversation: { ...target.conversation, id: 'second' } }, 100, 'epoch-z'),
      row({ ...target, conversation: { ...target.conversation, id: 'third' } }, 50, 'epoch-b'),
    ];
    const f = fixture(data);
    const first = await f.directory(identity.owner, { limit: 1, offset: 0 });
    expect(first.rows).toHaveLength(1); expect(first.hasMore).toBe(true);
    expect(first.rows[0]!.address.conversation.id).toBe('second');
    const second = await f.directory(identity.owner, { limit: 1, offset: 1 });
    expect(second.rows[0]).toEqual({ sessionKey: identity.key, address: identity.address, updatedAt: 100 });
    expect(second.hasMore).toBe(true);
    const third = await f.directory(identity.owner, { limit: 1, offset: 2 });
    expect(third.rows[0]!.address.conversation.id).toBe('third'); expect(third.hasMore).toBe(false);
    expect(f.operations.slice(0, 7).map(([name]) => name)).toEqual(['select', 'where', 'orderBy', 'orderBy', 'limit', 'offset', 'execute']);
    expect(f.operations[1]![1]).toEqual({ status: 'active', source_kind: 'im', source_root: 'k1:/host-a', source_platform: 'k1:qq',
      source_instance: 'k1:account-a', source_subject: 'k1:alice', source_endpoint: 'k1:root%00zhin.adapter%00qq' });
    expect(f.operations[4]).toEqual(['limit', 2]);
    expect(f.select.mock.calls[0]).not.toContain('payload'); expect(f.select.mock.calls[0]).not.toContain('content');
    expect(Object.isFrozen(first.rows[0]!.address.conversation.endpoint)).toBe(true);
  });

  it('reconstructs parent/thread identities and literal percent text without changing Session keys', async () => {
    const target = address(); const own = personalSessionIdentity(target).owner;
    const targets = [target, { ...target, conversation: { ...target.conversation, threadId: 'other-topic' } },
      { ...target, conversation: { ...target.conversation, parent: { kind: 'group' as const, id: 'other-guild' } } }];
    const f = fixture(targets.map((address, index) => row(address, 100 - index, `epoch-${index}`)));
    const result = await f.directory(own, { limit: 10, offset: 0 });
    expect(result.rows.map(row => row.address)).toEqual(targets);
    expect(new Set(result.rows.map(row => row.sessionKey)).size).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it('returns no legacy/shared/archived rows and preserves database failures as failures', async () => {
    const own = personalSessionIdentity(address()).owner;
    const source = row();
    const f = fixture([{ ...source, status: 'archived' }, { ...source, source_subject: null }, { ...source, source_kind: 'schedule' }]);
    expect(await f.directory(own, { limit: 10, offset: 0 })).toEqual({ rows: [], hasMore: false });
    const failure = new Error('database offline');
    await expect(fixture([], { fail: failure }).directory(own, { limit: 10, offset: 0 })).rejects.toBe(failure);
  });

  it('rejects a mismatched persisted key or unexpected owner even if the builder violates its filter', async () => {
    const own = personalSessionIdentity(address()).owner;
    await expect(fixture([{ ...row(), session_key: 'legacy-shared-key' }]).directory(own, { limit: 10, offset: 0 })).rejects.toBeInstanceOf(PersonalModelStateIntegrityError);
    const foreign = row({ ...address(), subjectId: 'bob' });
    await expect(fixture([foreign], { ignoreWhere: true }).directory(own, { limit: 10, offset: 0 })).rejects.toBeInstanceOf(PersonalModelStateIntegrityError);
    await expect(fixture([{ ...row(), source_parent_kind: null }]).directory(own, { limit: 10, offset: 0 })).rejects.toBeInstanceOf(PersonalModelStateIntegrityError);
  });

  it('fails closed when persistence or owner identity is unavailable and validates pagination', async () => {
    const own = personalSessionIdentity(address()).owner;
    await expect(createPersonalSessionDirectory(() => undefined)(own, { limit: 10, offset: 0 })).rejects.toBeInstanceOf(PersonalModelStateUnavailableError);
    const f = fixture([]);
    await expect(createPersonalSessionDirectory(() => ({ ...f.host, started: false }))(own, { limit: 10, offset: 0 })).rejects.toBeInstanceOf(PersonalModelStateUnavailableError);
    await expect(f.directory({ ...own, subjectId: '' }, { limit: 10, offset: 0 })).rejects.toThrow(TypeError);
    await expect(f.directory(own, { limit: 0, offset: 0 })).rejects.toThrow(TypeError);
    await expect(f.directory(own, { limit: 10, offset: -1 })).rejects.toThrow(TypeError);
    expect(f.select).not.toHaveBeenCalled();
  });
});
