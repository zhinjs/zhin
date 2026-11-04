import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { childPluginId, rootPluginId } from 'zhin.js';
import definition from '../adapters/satori/index.js';
import listCommand from '../commands/satori/endpoint/list/index.js';
import addCommand from '../commands/satori/endpoint/add/[id]/index.js';
import removeCommand from '../commands/satori/endpoint/remove/[id]/index.js';
import { runtimeCommandFixture } from '../../napcat/tests/runtime-command-fixture.js';

const args = ['platform=qq', 'userId=777', 'baseUrl=http://127.0.0.1:1', 'token=private-fixture'];
const fixture = () => runtimeCommandFixture(definition, 'satori', { id: 'baseline', platform: 'qq', userId: '777', baseUrl: 'http://127.0.0.1:1' });
describe('satori commands through the real Adapter directory', () => {
  it('keeps the three published command definitions valid', () => {
    for (const command of [listCommand, addCommand, removeCommand]) expect(() => parseCommandDefinition(command)).not.toThrow();
  });
  it('persists add as disabled without creating a Client or touching startup storage', async () => {
    const f = await fixture();
    const text = await addCommand.execute(f.context({ params: { id: 'bot1' }, args }));
    expect(text).toContain('已保存'); expect(text).toContain('尚未启动');
    expect(f.saved().endpoints[0]).toMatchObject({ endpointId: 'bot1', desiredEnabled: false, config: { token: 'private-fixture' } });
    expect(f.harness.endpoint).toBeUndefined(); expect(f.compareAndSet).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.harness.adapter.list())).not.toContain('private-fixture');
    expect(f.harness.adapter.configurationView([{ key: 'token', env: true }])[0]?.values.token).toBe('••••••');
  });
  it('rejects undeclared fields before any CAS', async () => {
    const f = await fixture();
    const text = await addCommand.execute(f.context({ params: { id: 'bot1' }, args: [...args, 'ghost=x'] }));
    expect(text).toContain('未声明'); expect(f.compareAndSet).not.toHaveBeenCalled(); expect(f.saved().endpoints).toHaveLength(0);
  });
  it('does not save incomplete configuration', async () => {
    const f = await fixture();
    const text = await addCommand.execute(f.context({ params: { id: 'bot1' }, args: [] }));
    expect(text).not.toContain('已保存'); expect(f.compareAndSet).not.toHaveBeenCalled();
  });
  it('lists configured accounts from the owning Adapter instead of a second running Map', async () => {
    const f = await fixture();
    await addCommand.execute(f.context({ params: { id: 'bot1' }, args }));
    await addCommand.execute(f.context({ params: { id: 'conf-bot' }, args }));
    const text = await listCommand.execute(f.context());
    expect(text).toContain('bot1'); expect(text).toContain('conf-bot'); expect(text).toContain('持久账号配置');
    expect(text).not.toContain('private-fixture'); expect(f.harness.endpoint).toBeUndefined();
  });
  it('removes only the selected persisted account without requesting a process restart', async () => {
    const f = await fixture();
    await addCommand.execute(f.context({ params: { id: 'bot1' }, args }));
    await addCommand.execute(f.context({ params: { id: 'keep' }, args }));
    const text = await removeCommand.execute(f.context({ params: { id: 'bot1' } }));
    expect(text).toContain('删除配置已保存'); expect(text).not.toContain('重启');
    expect(f.saved().endpoints.map(row => row.endpointId)).toEqual(['keep']);
  });
  it('preserves the configured master boundary for add and remove', async () => {
    const f = await fixture();
    const denied = f.context({ config: { master: 'alice' }, input: { sender: { id: 'bob' } }, params: { id: 'bot1' }, args });
    expect(await addCommand.execute(denied)).toBe('仅 master 可执行 Satori endpoint 管理命令');
    expect(await removeCommand.execute(denied)).toBe('仅 master 可执行 Satori endpoint 管理命令');
    expect(f.compareAndSet).not.toHaveBeenCalled();
  });
  it('fails explicitly without a runtime directory instead of falling back to startup files', async () => {
    const f = await fixture(); const absent = f.context({ project: undefined, params: { id: 'bot1' }, args });
    await expect(addCommand.execute(absent)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(removeCommand.execute(absent)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(listCommand.execute(absent)).rejects.toMatchObject({ code: 'unsupported' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
  });
  it("does not select another owner's Adapter", async () => {
    const f = await fixture();
    await expect(addCommand.execute(f.context({ owner: childPluginId(rootPluginId(), 'other'), params: { id: 'bot1' }, args }))).rejects.toThrow();
    expect(f.compareAndSet).not.toHaveBeenCalled();
  });
});
