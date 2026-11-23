import { createMemoryContextRepository, createUserMessage, EMPTY_TOKEN_USAGE } from '@zhin.js/ai';
import { jumpSessionTree, listSessionTree } from '../../src/session/session-tree-commands.js';
import { AgentCompactionRuntime } from '../../src/memory/compaction-runtime.js';

async function fixture() {
  const { repository, sessionStore } = createMemoryContextRepository();
  const session = await sessionStore.getOrCreateActive({ session_key: 'audit' });
  const zhinAgent = { contextRepository: repository, agentSessionStore: sessionStore };
  return { repository, sessionStore, session, zhinAgent };
}

it('renders real memory repository branches with exact command hints and preserved user previews', async () => {
  const { repository, zhinAgent, session } = await fixture();
  const references = { tree: '!tree', fork: '!fork' };
  const tree = () => listSessionTree(zhinAgent as never, 'audit', { locale: 'en', references });
  const jump = (index: number) => jumpSessionTree(zhinAgent as never, 'audit', index, 'en');
  expect(await tree()).toContain('no user branch points');
  await repository.appendMessages(session.session_id, [createUserMessage('用户原文'), createUserMessage('Second branch')]);
  const list = await tree();
  expect(list).toContain('!tree N');
  expect(list).toContain('!fork N');
  expect(list).toContain('用户原文');
  expect(await listSessionTree(zhinAgent as never, 'audit', { locale: 'en' })).not.toMatch(/\/tree|\/fork|!tree|undefined/);
  expect(await jump(99)).toBe('ℹ️ Branch point #99 was not found.');
  expect(await jump(1)).toBe('✅ Switched to branch point #1: 用户原文');
  vi.spyOn(repository, 'setActiveLeaf').mockResolvedValue(false);
  expect(await jump(1)).toBe('ℹ️ Failed to switch branch points.');
  vi.spyOn(repository, 'jumpToBranchIndex').mockResolvedValue({ ok: true, message: '自定义 repository message' });
  expect(await jump(1)).toBe('✅ 自定义 repository message');
});

it('passes language through explicit compaction without changing the compaction algorithm', async () => {
  const { repository, session } = await fixture();
  const runtime = new AgentCompactionRuntime();
  const transform = vi.spyOn(runtime, 'transformContext').mockResolvedValue([]);
  const options = { locale: 'en' as const, host: { contextRepository: repository }, sessionId: session.session_id,
    model: { id: 'fixture' } as never, transport: {} as never, contextWindow: 32000 };
  expect((await runtime.compactSession(repository, { ...options, compactionConfig: { enabled: false } })).message).toContain('Compaction is disabled');
  expect((await runtime.compactSession(repository, options)).message).toBe('Too few messages to compact.');
  expect(transform).not.toHaveBeenCalled();
  await repository.appendMessages(session.session_id, [createUserMessage('Keep this unchanged'), {
    role: 'assistant', content: [{ type: 'text', text: 'Custom content' }], api: 'fixture', provider: 'fixture',
    model: 'fixture', stopReason: 'stop', usage: EMPTY_TOKEN_USAGE, timestamp: 1,
  }]);
  expect((await runtime.compactSession(repository, options)).message).toMatch(/^Compacted the session/);
  expect(transform).toHaveBeenCalledOnce();
});
