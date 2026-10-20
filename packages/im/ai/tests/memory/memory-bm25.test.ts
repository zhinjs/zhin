import { describe, expect, it } from 'vitest';
import { rankBm25, rankMemoryEntries, tokenizeForBm25 } from '../../src/memory/memory-bm25.js';
import { InMemoryMemoryEntryRepository } from '../../src/memory/memory-entry-repository.js';
import type { MemoryEntryUpsertInput } from '../../src/memory/memory-entry-models.js';

/** Retrieval-quality baseline (#734). Raise the bar, never lower it, when ranking changes. */
const CORPUS: ReadonlyArray<MemoryEntryUpsertInput & { id: string }> = [
  { id: 'drink', scope: 'user', key: 'preference:drink', content: '喜欢喝乌龙茶，不加糖', kind: 'preference' },
  { id: 'coffee', scope: 'user', key: 'preference:coffee', content: 'Dislikes coffee after 3pm', kind: 'preference' },
  { id: 'city', scope: 'user', key: 'home_city', content: '住在马尼拉 Makati 区' },
  { id: 'birthday', scope: 'user', key: 'birthday', content: 'Birthday is March 14' },
  { id: 'cat', scope: 'user', key: 'pet', content: '养了一只橘猫，名字叫团子' },
  { id: 'stack', scope: 'global', key: 'project:stack', content: 'zhin uses TypeScript, pnpm workspaces and vitest' },
  { id: 'deploy', scope: 'global', key: 'deploy:target', content: 'Production deploys go to the Fly.io region sin' },
  { id: 'standup', scope: 'global', key: 'meeting:standup', content: '每天上午十点站会，周五取消' },
  { id: 'language', scope: 'user', key: 'preference:language', content: 'Prefers replies in Chinese, code comments in English' },
  { id: 'allergy', scope: 'user', key: 'health:allergy', content: '对花生过敏' },
  { id: 'editor', scope: 'user', key: 'tools:editor', content: 'Uses IntelliJ IDEA on macOS' },
  { id: 'timezone', scope: 'user', key: 'timezone', content: 'Timezone Asia/Manila (UTC+8)' },
  { id: 'db', scope: 'global', key: 'project:database', content: '默认数据库是 sqlite，生产用 PostgreSQL' },
  { id: 'release', scope: 'global', key: 'release:cadence', content: 'Releases are cut every Tuesday via changesets' },
  { id: 'noise1', scope: 'user', key: 'note:1', content: 'The weather was nice yesterday' },
  { id: 'noise2', scope: 'user', key: 'note:2', content: '昨天看了一部电影' },
];

const QUERIES: ReadonlyArray<readonly [string, string]> = [
  ['我喜欢喝什么茶', 'drink'],
  ['when is my birthday', 'birthday'],
  ['我住在哪里', 'city'],
  ['我的猫叫什么', 'cat'],
  ['which test runner does the project use', 'stack'],
  ['where do we deploy production', 'deploy'],
  ['站会几点', 'standup'],
  ['我对什么过敏', 'allergy'],
  ['what editor do I use', 'editor'],
  ['生产数据库用什么', 'db'],
  ['how often do we release', 'release'],
  ['my timezone', 'timezone'],
];

async function seed() {
  const repository = new InMemoryMemoryEntryRepository();
  const ids = new Map<string, string>();
  for (const { id, ...entry } of CORPUS) {
    const record = await repository.upsert({ ...entry, scope_key: entry.scope === 'user' ? 'u1' : '' });
    ids.set(record.id, id);
  }
  return { repository, ids };
}

describe('BM25 memory retrieval', () => {
  it('tokenizes Latin words and CJK bigrams', () => {
    expect(tokenizeForBm25('Hello, World_2 喝茶')).toEqual(['hello', 'world', '2', '喝', '喝茶', '茶']);
  });

  it('meets the retrieval-quality baseline (top-1 ≥ 0.8, recall@3 = 1)', async () => {
    const { repository, ids } = await seed();
    const all = [
      ...await repository.list({ scope: 'user', scope_key: 'u1', limit: 100 }),
      ...await repository.list({ scope: 'global', limit: 100 }),
    ];
    let top1 = 0;
    let top3 = 0;
    for (const [query, expected] of QUERIES) {
      const ranked = rankMemoryEntries(all, query).map((hit) => ids.get(hit.item.id));
      if (ranked[0] === expected) top1 += 1;
      if (ranked.slice(0, 3).includes(expected)) top3 += 1;
    }
    expect(top1 / QUERIES.length).toBeGreaterThanOrEqual(0.8);
    expect(top3).toBe(QUERIES.length);
  });

  it('weights rare terms above common ones', () => {
    const docs = ['tea tea tea', 'tea oolong', 'coffee'];
    expect(rankBm25(docs, 'oolong tea', (doc) => doc)[0]!.item).toBe('tea oolong');
    expect(rankBm25(docs, 'water', (doc) => doc)).toEqual([]);
  });

  it('stops returning deleted entries', async () => {
    const { repository } = await seed();
    const [hit] = await repository.search({ query: '橘猫', scope: 'user', scope_key: 'u1' });
    expect(hit?.key).toBe('pet');
    await repository.delete(hit!.id);
    expect(await repository.search({ query: '橘猫', scope: 'user', scope_key: 'u1' })).toEqual([]);
    expect((await repository.list({ scope: 'user', scope_key: 'u1' })).some((entry) => entry.id === hit!.id)).toBe(false);
  });
});
