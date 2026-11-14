import { describe, expect, it } from 'vitest';
import { PluginStateStore, type PersistentStatePort, type StateRecord } from 'zhin.js';
import { createGroupSuiteConsoleRpc, createGroupSuiteRuntime, type GroupSuiteConsoleStatus } from '../src/index.js';
import { conversationKey } from '../src/conversation-scope.js';
import { keywords, readKeywordIndex } from '../src/keywords.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';
import page from '../pages/index/index.ts';

function memoryPort(): PersistentStatePort {
  const rows = new Map<string, StateRecord>();
  let revision = 0;
  const id = (owner: unknown, scope: unknown, key: string) => JSON.stringify([owner, scope, key]);
  return {
    async read(owner, scope, key) { return rows.get(id(owner, scope, key)); },
    async compareExchange(owner, scope, key, expected, value, expiresAt) {
      const at = id(owner, scope, key);
      if (rows.get(at)?.revision !== expected) return false;
      if (value === undefined) rows.delete(at);
      else rows.set(at, { revision: String(++revision), value, expiresAt });
      return true;
    },
  };
}

const target = (id: string) => ({ endpoint: { adapter: 'sandbox', id: 'root/sandbox\u0000zhin.adapter\u0000sandbox~bot' }, kind: 'group' as const, id });

describe('group-suite Console: persistent keywords are counted like keyword-list (#1250)', () => {
  it('indexes conversations with persistent keywords and lists them with their conversation key', async () => {
    const state = new PluginStateStore('root/group-suite' as never, memoryPort());
    const context = { config: {}, use: <T>() => ({ state }) as T };
    const repo = (id: string) => keywords({ conversation: target(id) }, context);
    await repo('g1').update(store => { store.set('你好', '欢迎'); store.set('再见', '拜拜'); });
    await repo('g2').update(store => { store.set('签到', '发送 签到'); });
    await repo('g2').update(store => { store.clear(); });
    expect((await readKeywordIndex(state)).map(item => item.id)).toEqual(['g1']);

    const rpc = createGroupSuiteConsoleRpc(createGroupSuiteRuntime(createInMemoryGroupSuiteDb()), { keywordState: () => state });
    const status = await rpc.methods.get('status')!.handler({}, { signal: new AbortController().signal }) as unknown as GroupSuiteConsoleStatus;
    expect(status.keywordCount).toBe(2);
    expect(status.teachCount).toBe(0);
    expect(status.qaCount).toBe(2);
    expect(status.keywords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'keyword', keyword: '你好', groupId: conversationKey(target('g1')) }),
    ]));
  });

  it('shows conversations by display name and users by nickname on the page', () => {
    const spec = (page as unknown as { spec: { sections: { id?: string; columns?: { key: string; type?: string }[] }[]; stats: { key?: string }[] } }).spec;
    const checkins = spec.sections.find(section => section.id === 'topCheckins')!.columns!;
    expect(checkins.find(column => column.key === 'groupId')?.type).toBe('conversation');
    expect(checkins.map(column => column.key)).toContain('user');
    const rules = spec.sections.find(section => section.id === 'keywords')!.columns!;
    expect(rules.find(column => column.key === 'groupId')?.type).toBe('conversation');
    expect(spec.stats.map(stat => stat.key)).toContain('qaCount');
  });
});
