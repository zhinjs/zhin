import { createGroupSuiteRuntime } from '../src/runtime-state.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';
import { doCheckin, myPoints } from '../src/checkin-lib.js';
import { teachAdd, tryTeachReply } from '../src/teach-lib.js';
import { recordMessage, flushStatsBuffer, queryStats, resolveGroupId } from '../src/stats-lib.js';
import { resolveGroupSuiteConfig } from '../src/config.js';

const first = { conversation: { kind: 'group' as const, id: 'same-group', endpoint: { adapter: 'test', id: 'one' } }, sender: { id: 'u', name: 'User' } };
const second = { ...first, conversation: { ...first.conversation, endpoint: { adapter: 'test', id: 'two' } } };

it('isolates checkin, teaching and count records by the complete conversation', async () => {
  const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
  const config = resolveGroupSuiteConfig({});
  expect(await doCheckin(first, config, runtime)).toContain('签到成功');
  expect(await myPoints(second, runtime)).toContain('没有签到记录');
  expect(await doCheckin(second, config, runtime)).toContain('签到成功');
  await teachAdd(first, config, 'where|one', false, runtime);
  await teachAdd(second, config, 'where|two', false, runtime);
  expect(await tryTeachReply({ ...first, content: 'where' }, config, runtime)).toBe('one');
  expect(await tryTeachReply({ ...second, content: 'where' }, config, runtime)).toBe('two');
  recordMessage(first, runtime); recordMessage(first, runtime); recordMessage(second, runtime);
  await flushStatsBuffer(runtime);
  expect((await queryStats(resolveGroupId(first), '', runtime)).get('u')?.count).toBe(2);
  expect((await queryStats(resolveGroupId(second), '', runtime)).get('u')?.count).toBe(1);
});

it('does not attribute legacy bare group records to any endpoint', async () => {
  const db = createInMemoryGroupSuiteDb();
  const runtime = createGroupSuiteRuntime(db);
  await db.models.get('message_stats')!.insert({ group_id: 'same-group', user_id: 'legacy', date: '2026-01-01', count: 999 });
  await db.models.get('teach_qa')!.insert({ context_type: 'group', context_id: 'same-group', question: 'legacy', answer: 'leak' });
  expect((await queryStats(resolveGroupId(first), '', runtime)).size).toBe(0);
  expect(await tryTeachReply({ ...first, content: 'legacy' }, resolveGroupSuiteConfig({}), runtime)).toBeNull();
});

it('single-flights overlapping query/schedule flushes without losing new increments', async () => {
  const db = createInMemoryGroupSuiteDb();
  const model = db.models.get('message_stats')!;
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const delayed = { ...model, select: () => ({ where: async (filter: Record<string, unknown>) => { await waiting; return model.select().where(filter); } }) };
  const runtime = createGroupSuiteRuntime({ models: { get: name => name === 'message_stats' ? delayed : db.models.get(name) } });
  recordMessage(first, runtime);
  const one = flushStatsBuffer(runtime);
  const two = flushStatsBuffer(runtime);
  expect(one).toBe(two);
  recordMessage(first, runtime); resume();
  await Promise.all([one, two]);
  expect([...runtime.statsBuffer.values()][0]?.count).toBe(1);
  await flushStatsBuffer(runtime);
  expect(runtime.statsBuffer.size).toBe(0);
  expect((await queryStats(resolveGroupId(first), '', runtime)).get('u')?.count).toBe(2);
});
