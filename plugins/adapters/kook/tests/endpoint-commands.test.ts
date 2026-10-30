import { afterEach, describe, expect, it, vi } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { parseCommandDefinition } from 'zhin.js/command';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import definition from '../adapters/kook/index.js';
import listCommand from '../commands/kook/endpoint/list/index.js';
import addCommand from '../commands/kook/endpoint/add/[id]/index.js';
import removeCommand from '../commands/kook/endpoint/remove/[id]/index.js';

const fixtures: Awaited<ReturnType<typeof createAdapterHarness>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.stop())); });
async function fixture(config: Record<string, unknown> = {}) {
  const repository = new MemoryDesiredRepository();
  const runtime = await createAdapterHarness(definition, config, { name: 'kook', repository });
  fixtures.push(runtime); await runtime.start(); runtime.open();
  const use = vi.fn(() => { throw new Error('No file/env port belongs to account management'); });
  function context(overrides: Record<string, unknown> = {}) {
    return { owner: rootPluginId(), generation: 1, project: () => runtime.index,
      use, config, input: undefined, params: {}, args: [], ...overrides } as never;
  }
  return { adapter: runtime.adapter, index: runtime.index, repository, use, context };
}

describe('KOOK commands use the owning runtime account authority', () => {
  it('retains the three actual command definitions', () => {
    for (const command of [listCommand, addCommand, removeCommand]) expect(() => parseCommandDefinition(command)).not.toThrow();
  });
  it('saves a new inactive account through one CAS without constructing a Client, env write, or restart', async () => {
    const runtime = await fixture();
    const text = await addCommand.execute(runtime.context({ params: { id: 'bot1' }, args: ['token=123:abc'] })) as string;
    expect(text).toContain('配置已保存，尚未启动'); expect(text).toContain('无需重启进程');
    expect(runtime.repository.writes).toHaveLength(1);
    expect(runtime.repository.snapshot?.endpoints[0]).toMatchObject({ endpointId: 'bot1', desiredEnabled: false, config: { id: 'bot1', token: '123:abc' } });
    expect(runtime.adapter.getEndpoint(runtime.adapter.list()[0]!.instanceId)).toBeUndefined();
    expect(runtime.use).not.toHaveBeenCalled();
    const listed = await listCommand.execute(runtime.context()) as string;
    expect(listed).toContain('bot1'); expect(listed).not.toContain('123:abc');
  });
  it('rejects a missing credential without writing', async () => {
    const runtime = await fixture();
    expect(await addCommand.execute(runtime.context({ params: { id: 'bot1' } }))).toContain('缺少必填字段：token');
    expect(runtime.repository.writes).toHaveLength(0);
  });
  it('removes the exact owned saved account without touching startup files', async () => {
    const runtime = await fixture();
    await addCommand.execute(runtime.context({ params: { id: 'bot1' }, args: ['token=t'] }));
    const result = await removeCommand.execute(runtime.context({ params: { id: 'bot1' } })) as string;
    expect(result).toContain('删除配置已保存'); expect(result).not.toContain('重启');
    expect(runtime.adapter.list()).toHaveLength(0); expect(runtime.repository.writes).toHaveLength(2);
    expect(runtime.use).not.toHaveBeenCalled();
  });
  it('preserves the existing master authorization before account admission', async () => {
    const runtime = await fixture({ master: 'alice' });
    const denied = runtime.context({ input: { sender: { id: 'bob' } }, params: { id: 'bot1' }, args: ['token=t'] });
    expect(await addCommand.execute(denied)).toBe('仅 master 可执行 KOOK endpoint 管理命令');
    expect(await removeCommand.execute(denied)).toBe('仅 master 可执行 KOOK endpoint 管理命令');
    expect(runtime.repository.writes).toHaveLength(0);
  });
});
