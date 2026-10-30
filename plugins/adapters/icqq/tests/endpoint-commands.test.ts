import { afterEach, describe, expect, it, vi } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { parseCommandDefinition } from 'zhin.js/command';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import definition from '../adapters/icqq/index.js';
import listCommand from '../commands/icqq/endpoint/list/index.js';
import addCommand from '../commands/icqq/endpoint/add/[[id]]/index.js';
import removeCommand from '../commands/icqq/endpoint/remove/[id]/index.js';

const fixtures: Awaited<ReturnType<typeof createAdapterHarness>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.stop())); });
async function fixture(config: Record<string, unknown> = {}) {
  const repository = new MemoryDesiredRepository();
  const runtime = await createAdapterHarness(definition, config, { name: 'icqq', repository });
  fixtures.push(runtime); await runtime.start(); runtime.open();
  const use = vi.fn(() => { throw new Error('No file/env port belongs to account management'); });
  function context(overrides: Record<string, unknown> = {}) {
    return { owner: rootPluginId(), generation: 1, project: () => runtime.index,
      use, config, input: undefined, params: {}, args: [], ...overrides } as never;
  }
  return { adapter: runtime.adapter, index: runtime.index, repository, use, context };
}

describe('ICQQ commands use the owning runtime account authority', () => {
  it('retains the three actual command definitions', () => {
    for (const command of [listCommand, addCommand, removeCommand]) expect(() => parseCommandDefinition(command)).not.toThrow();
  });
  it('saves a new inactive account through one CAS without constructing a Client, env write, or restart', async () => {
    const runtime = await fixture();
    const text = await addCommand.execute(runtime.context({ params: { id: '8596238' }, args: [] })) as string;
    expect(text).toContain('配置已保存，尚未启动'); expect(text).toContain('无需重启进程');
    expect(runtime.repository.writes).toHaveLength(1);
    expect(runtime.repository.snapshot?.endpoints[0]).toMatchObject({ endpointId: '8596238', desiredEnabled: false, config: { id: '8596238' } });
    expect(runtime.adapter.getEndpoint(runtime.adapter.list()[0]!.instanceId)).toBeUndefined();
    expect(runtime.use).not.toHaveBeenCalled();
    const listed = await listCommand.execute(runtime.context()) as string;
    expect(listed).toContain('8596238'); expect(listed).toContain('直连');
  });
  it('rejects an invalid QQ account identity without writing', async () => {
    const runtime = await fixture();
    expect(await addCommand.execute(runtime.context({ params: { id: 'invalid-account' } }))).not.toContain('配置已保存');
    expect(runtime.repository.writes).toHaveLength(0);
  });
  it('removes the exact owned saved account without touching startup files', async () => {
    const runtime = await fixture();
    await addCommand.execute(runtime.context({ params: { id: '8596238' }, args: [] }));
    const result = await removeCommand.execute(runtime.context({ params: { id: '8596238' } })) as string;
    expect(result).toContain('删除配置已保存'); expect(result).not.toContain('重启');
    expect(runtime.adapter.list()).toHaveLength(0); expect(runtime.repository.writes).toHaveLength(2);
    expect(runtime.use).not.toHaveBeenCalled();
  });
  it('preserves the existing master authorization before account admission', async () => {
    const runtime = await fixture({ master: 'alice' });
    const denied = runtime.context({ input: { sender: { id: 'bob' } }, params: { id: '8596238' }, args: [] });
    expect(await addCommand.execute(denied)).toBe('仅 master 可执行 ICQQ endpoint 管理命令');
    expect(await removeCommand.execute(denied)).toBe('仅 master 可执行 ICQQ endpoint 管理命令');
    expect(runtime.repository.writes).toHaveLength(0);
  });
});
