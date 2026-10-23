import { Registry } from '@zhin.js/database';
import { AGENT_MESSAGE_MODEL, AGENT_SESSION_MODEL, AGENT_SUMMARY_MODEL } from '../../src/memory/agent-db-models.js';
import { AgentSessionStore, MemoryAgentSessionStore } from '../../src/memory/agent-session-store.js';
import { DatabaseContextRepository, MemoryContextRepository } from '../../src/memory/context-repository.js';
import { createUserMessage, type AgentMessage } from '../../src/llm/types/agent-message.js';

const content = (messages: AgentMessage[]) => messages.map(message => message.content);
type DbSchema = { agent_sessions: Record<string, unknown>; agent_messages: Record<string, unknown>; agent_summaries: Record<string, unknown> };

describe.each(['memory', 'sqlite'] as const)('%s compaction checkpoint provenance', (kind) => {
  let repo: MemoryContextRepository | DatabaseContextRepository;
  let sessionId: string;
  let db: ReturnType<typeof Registry.create<DbSchema, 'sqlite'>> | undefined;

  beforeEach(async () => {
    let store: MemoryAgentSessionStore | AgentSessionStore = new MemoryAgentSessionStore();
    if (kind === 'sqlite') {
      db = Registry.create<DbSchema, 'sqlite'>('sqlite', { filename: ':memory:' });
      db.define('agent_sessions', AGENT_SESSION_MODEL);
      db.define('agent_messages', AGENT_MESSAGE_MODEL);
      db.define('agent_summaries', AGENT_SUMMARY_MODEL);
      await db.start();
      store = new AgentSessionStore(db.models.get('agent_sessions')!);
      repo = new DatabaseContextRepository(db.models.get('agent_messages')!, db.models.get('agent_summaries')!, store, { tailMessageLimit: 3 });
    } else {
      repo = new MemoryContextRepository(store, { tailMessageLimit: 3 });
    }
    sessionId = (await store.getOrCreateActive({ session_key: 'checkpoint' })).session_id;
    // Equal content and timestamps must not be used to guess row identity.
    await repo.appendMessages(sessionId, Array.from({ length: 5 }, () => createUserMessage('same', undefined, 1)));
  });
  afterEach(async () => { vi.restoreAllMocks(); await db?.stop(); });

  it('anchors to the displayed tail, incorporates prior summary, and retains raw rows', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10);
    const first = (await repo.loadContext(sessionId)).messages;
    expect(first).toHaveLength(3);
    expect(await repo.saveCompactionSummary(sessionId, 'first', first.slice(0, 1))).toBe(true);
    const second = (await repo.loadContext(sessionId)).messages;
    expect(content(second.slice(1))).toEqual(content(first.slice(1)));
    expect(await repo.saveCompactionSummary(sessionId, 'second', second.slice(0, 2))).toBe(true);
    const final = (await repo.loadContext(sessionId)).messages;
    expect(final).toHaveLength(2);
    expect(final[0]).toMatchObject({ content: [{ text: '[Previous conversation summary]\nsecond' }] });
    expect(content(final.slice(1))).toEqual(content(second.slice(2)));
    expect(await repo.loadMessageRows(sessionId)).toHaveLength(5);
  });

  it('does not cut off a retained branch summary from its raw anchor', async () => {
    const rows = await repo.loadMessageRows(sessionId);
    await repo.saveSummary(sessionId, 'branch', { branchAnchorMessageId: rows[2]!.id });
    const loaded = (await repo.loadContext(sessionId)).messages;
    expect(loaded).toHaveLength(4);
    expect(await repo.saveCompactionSummary(sessionId, 'unsafe', loaded.slice(0, 1))).toBe(false);
    expect(content((await repo.loadContext(sessionId)).messages)).toEqual(content(loaded));
    expect(await repo.saveCompactionSummary(sessionId, 'safe', loaded.slice(0, 2))).toBe(true);
    expect(content((await repo.loadContext(sessionId)).messages.slice(1))).toEqual(content(loaded.slice(2)));
  });

  it.each(['append', 'branch', 'summary'] as const)('rejects a checkpoint after concurrent %s changes', async (change) => {
    const loaded = (await repo.loadContext(sessionId)).messages;
    if (change === 'append') await repo.appendMessages(sessionId, [createUserMessage('new')]);
    if (change === 'branch') await repo.setActiveLeaf(sessionId, (await repo.loadMessageRows(sessionId))[0]!.id!);
    if (change === 'summary') await repo.saveSummary(sessionId, 'new summary', 2);
    const current = (await repo.loadContext(sessionId)).messages;
    expect(await repo.saveCompactionSummary(sessionId, 'stale', loaded.slice(0, 1))).toBe(false);
    expect(content((await repo.loadContext(sessionId)).messages)).toEqual(content(current));
  });

  it('does not register an old projection with a summary added during load', async () => {
    const rows = await repo.loadMessageRows(sessionId);
    await repo.saveSummary(sessionId, 'old summary', rows[0]!.id!);
    const store: MemoryAgentSessionStore | AgentSessionStore = Reflect.get(repo, 'sessionStore');
    const original = store.getBySessionId.bind(store);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.spyOn(store, 'getBySessionId').mockImplementationOnce(async (id) => {
      entered.resolve();
      await release.promise;
      return original(id);
    });
    const loading = repo.loadContext(sessionId);
    await entered.promise;
    await repo.saveSummary(sessionId, 'new concurrent summary', rows[2]!.id!);
    release.resolve();
    const stale = (await loading).messages;
    const current = (await repo.loadContext(sessionId)).messages;
    expect(await repo.saveCompactionSummary(sessionId, 'stale', stale.slice(0, 2))).toBe(false);
    expect(content((await repo.loadContext(sessionId)).messages)).toEqual(content(current));
  });

  it('rejects reordered, cloned, mixed-snapshot, and unpersisted prefixes', async () => {
    const loaded = (await repo.loadContext(sessionId)).messages;
    const other = (await repo.loadContext(sessionId)).messages;
    for (const prefix of [loaded.slice(1), [structuredClone(loaded[0]!)], [loaded[0]!, other[1]!], [...loaded, createUserMessage('current turn')]]) {
      expect(await repo.saveCompactionSummary(sessionId, 'unsafe', prefix)).toBe(false);
    }
    expect(content((await repo.loadContext(sessionId)).messages)).toEqual(content(loaded));
  });

  it('honors cancellation queued behind a session write', async () => {
    const loaded = (await repo.loadContext(sessionId)).messages;
    const release = Promise.withResolvers<void>();
    const pending = Reflect.get(repo, 'writeLock').run(sessionId, () => release.promise);
    const controller = new AbortController();
    const save = repo.saveCompactionSummary(sessionId, 'cancelled', loaded.slice(0, 1), controller.signal);
    controller.abort();
    release.resolve();
    await pending;
    expect(await save).toBe(false);
    expect(content((await repo.loadContext(sessionId)).messages)).toEqual(content(loaded));
  });
});
