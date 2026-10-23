// Composition-root integration: real SQLite and public Agent storage ports, no model/platform calls.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scope, rootPluginId, databaseRootHostToken, GenerationHandoffStack, DisposeStack } from '@zhin.js/plugin-runtime';
import { AgentUsageCollector, agentUsageStoreToken } from '@zhin.js/agent/runtime';
import { ScheduleJobStore, type TurnRequest } from '@zhin.js/agent';
import { createScopedTraceJournal } from '@zhin.js/agent/trace';
import { AGENT_MESSAGE_MODEL, AGENT_SESSION_MODEL, AGENT_SUMMARY_MODEL, parseAgentMessageRow } from '@zhin.js/ai';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { installAgentPersistence } from '../../../src/plugin-runtime/agent/persistence-coordinator.js';

const request = {
  identity: { turnId: 'turn-1', traceId: 'trace-1' }, session: { key: 'channel:key' },
  origin: { kind: 'im', platform: 'slack', endpoint: 'bot', scope: 'channel', sceneId: 'room', conversation: {
    endpoint: { adapter: 'root/slack', id: 'root/slack\0bot' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'thread',
  } }, principal: { subjectId: 'alice', roles: [] }, input: { text: 'CHAT_BODY_MUST_NOT_ENTER_USAGE' },
} as unknown as TurnRequest;

describe('Agent structured persistence without Workroom', () => {
  let dir: string;
  let host: ReturnType<typeof createDatabaseHost>;
  let cleanup: DisposeStack;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'zhin-agent-db-')); host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'db.sqlite') }); cleanup = new DisposeStack(); });
  afterEach(async () => { await cleanup.dispose(); await host.stop(); await rm(dir, { recursive: true, force: true }); });

  async function activate(retentionDays = 30) {
    const resources = new Scope(rootPluginId()), handoff = new GenerationHandoffStack();
    resources.provide(databaseRootHostToken, host); handoff.add({ activateNext: () => host.start() });
    const foundation = { agent: { configure: vi.fn(), upgradeProfilesToDatabase: vi.fn(), markMemoryPersistenceReady: vi.fn() },
      service: {}, semanticMemory: null, schedule: { store: new ScheduleJobStore({ dataDir: join(dir, 'data') }), start: vi.fn(async () => {}) } };
    let publish!: () => void;
    const admission = { onActivate: (listener: () => void) => { publish = listener; return () => {}; } };
    installAgentPersistence({ resources, handoff, lifecycle: cleanup, admission: admission as never }, foundation as never, { usage: { retentionDays } } as never);
    expect(foundation.agent.markMemoryPersistenceReady).not.toHaveBeenCalled();
    handoff.seal(); await handoff.activateNext(new AbortController().signal);
    expect(foundation.schedule.start).not.toHaveBeenCalled(); publish();
    expect(foundation.agent.markMemoryPersistenceReady).toHaveBeenCalledOnce();
    expect(foundation.agent.configure).toHaveBeenCalled(); expect(foundation.schedule.start).toHaveBeenCalledOnce();
    return { store: resources.use(agentUsageStoreToken), foundation };
  }

  it('stores root/child numeric usage with explicit zero and unknown, preserves exact address and prunes independently', async () => {
    const { store } = await activate();
    const collector = new AgentUsageCollector('root', request, { provider: 'p', model: 'm' });
    const journal = createScopedTraceJournal({ append: event => collector.record(event) }, { turnId: 'child', sessionKey: 'child-session' });
    await journal.append({ type: 'usage', model: 'm2', provider: 'p2', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0,
      cacheReadTokens: 0, reported: { input: false, output: true, totalTokens: false, cacheRead: true } } });
    collector.record({ type: 'usage', model: 'm', provider: 'p', usage: { promptTokens: 20, completionTokens: 2, totalTokens: 22 } });
    collector.record({ type: 'chunk', content: 'OUTPUT_MUST_NOT_ENTER_USAGE' });
    const record = collector.finish('completed'); await store.save(record); await store.save(record);
    const turns = await host.models.get('agent_usage_turns')!.select();
    const calls = await host.models.get('agent_usage_calls')!.select().orderBy('turn_id');
    expect(turns).toHaveLength(1); expect(calls).toHaveLength(2);
    expect(turns[0]).toMatchObject({ call_count: 2, endpoint_id: 'k1:root/slack%00bot', parent_id: 'k1:guild', thread_id: 'k1:thread', principal_id: 'k1:alice' });
    expect(calls.find(row => row.turn_id === 'k1:child')).toMatchObject({ input_tokens: null, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: null });
    expect(JSON.stringify([turns, calls])).not.toContain('MUST_NOT_ENTER_USAGE');
    const stale = Date.now() - 31 * 86_400_000;
    await host.models.get('agent_usage_turns')!.update({ ended_at: stale }).where({ id: record.turn.id });
    await host.models.get('agent_usage_calls')!.update({ root_ended_at: stale }).where({ root_id: record.turn.id });
    await store.prune();
    expect(await host.models.get('agent_usage_turns')!.select()).toEqual([]);
    expect(await host.models.get('agent_usage_calls')!.select()).toEqual([]);
    expect(host.tables()).toContain('agent_messages');
  });

  it('adds query fields to an old DB without changing message, tree or compaction rows', async () => {
    const strip = (model: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(Object.entries(model).filter(([name]) => names.includes(name)));
    host.define('agent_messages', strip(AGENT_MESSAGE_MODEL, ['id', 'session_id', 'role', 'payload', 'parent_id', 'extra', 'timestamp']));
    host.define('agent_sessions', strip(AGENT_SESSION_MODEL, ['session_id', 'session_key', 'model', 'status', 'active_leaf_message_id', 'created_at', 'updated_at']));
    host.define('agent_summaries', AGENT_SUMMARY_MODEL); await host.start();
    const message = { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 10, actor: { subjectId: 'alice', scope: 'channel' }, cause: { turnId: 'old' } };
    await host.models.get('agent_messages')!.insert({ id: 1, session_id: 'epoch', role: 'user', payload: JSON.stringify(message), parent_id: null, timestamp: 10 });
    await host.models.get('agent_sessions')!.insert({ session_id: 'epoch', session_key: 'key', active_leaf_message_id: 1 });
    await host.models.get('agent_summaries')!.insert({ session_id: 'epoch', summary: 'prior', anchor_message_id: 1 });
    await host.stop(); host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'db.sqlite') });
    await activate();
    const row = (await host.models.get('agent_messages')!.select())[0]!;
    expect(row).toMatchObject({ actor_id: 'k1:alice', actor_scope: 'channel', turn_id: 'k1:old', query_version: 1, parent_id: null });
    expect(parseAgentMessageRow(row as never)).toEqual(message);
    expect((await host.models.get('agent_sessions')!.select())[0]).toMatchObject({ active_leaf_message_id: 1, source_kind: null });
    expect((await host.models.get('agent_summaries')!.select())[0]).toMatchObject({ summary: 'prior', anchor_message_id: 1 });
  });

  it('imports schedule-jobs once and preserves concurrent per-job mutations across restart', async () => {
    await mkdir(join(dir, 'data'));
    const job = { id: 'job', enabled: true, createdAt: 1, updatedAt: 1, schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'work' }, notify: { channel: 'silent' }, state: { lastStatus: 'error', retryCount: 2 },
      createdBy: { userId: 'alice', roles: ['user'] } };
    await writeFile(join(dir, 'data/schedule-jobs.json'), JSON.stringify({ version: 1, jobs: [job] }));
    const { foundation } = await activate(); const store = foundation.schedule.store;
    expect(await store.getJob('job')).toEqual(job);
    await Promise.all([store.upsertJob({ ...job, id: 'second' } as never), store.updateJobState('job', { retryCount: 3 })]);
    expect((await store.listJobs()).map(job => job.id)).toEqual(['job', 'second']);
    expect((await store.getJob('job'))!.state.retryCount).toBe(3);
    await store.removeJob('job'); await cleanup.dispose(); cleanup = new DisposeStack(); await host.stop();
    host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'db.sqlite') });
    const restarted = await activate();
    expect(await restarted.foundation.schedule.store.getJob('job')).toBeUndefined();
    expect((await restarted.foundation.schedule.store.listJobs()).map(job => job.id)).toEqual(['second']);
  });
});
