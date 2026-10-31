import { createTestEventGateway } from '../../test-utils/endpoint.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { AdapterIndex, AdapterManagementError, adapterFeatureId, endpointEventGatewayToken,
  type EndpointDesiredRepository, type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from 'zhin.js';
import definition from '../adapters/wechat-mp/index.js';
import listCommand from '../commands/wechat-mp/endpoint/list/index.js';
import addCommand from '../commands/wechat-mp/endpoint/add/[id]/index.js';
import removeCommand from '../commands/wechat-mp/endpoint/remove/[id]/index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const args = ['appId=synthetic-app', 'appSecret=synthetic-secret', 'token=synthetic-callback'];
async function fixture() {
  const owner = rootPluginId(), source = { endpoints: [] };
  let saved: EndpointDesiredSnapshot = { revision: 0, endpoints: [] };
  const write = vi.fn<EndpointDesiredRepository['compareAndSet']>(async (_id, revision, endpoints, commitId) => {
    if (revision !== saved.revision) throw new AdapterManagementError('conflict', 'synthetic conflict');
    return saved = structuredClone({ revision: revision + 1, endpoints, commitId });
  });
  const repository: EndpointDesiredRepository = { load: async () => saved, compareAndSet: write };
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'wechat-mp', source: '/fixture/adapters/wechat-mp/index.ts', definition });
  const state: SnapshotState = { root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[owner, source]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(), resources: new Map([[owner, new Map([[endpointEventGatewayToken.id, createTestEventGateway()]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(1, state), new AbortController().signal, { repository });
  await index.activate(new AbortController().signal); cleanups.push(() => index.stop());
  const adapter = index.adapter(slot.id)!;
  const use = vi.fn(() => { throw new Error('startup config/.env store must not be used'); });
  const context = (overrides: Record<string, unknown> = {}) => ({ owner, generation: 1, project: () => index, use,
    params: { id: 'bot1' }, args, input: undefined, config: source, signal: new AbortController().signal, ...overrides }) as never;
  return { index, adapter, source, context, write, use, saved: () => saved };
}

describe('wechat-mp actual convention Adapter account commands', () => {
  it('keeps all three convention command definitions valid', () => {
    for (const command of [listCommand, addCommand, removeCommand]) expect(() => parseCommandDefinition(command)).not.toThrow();
  });
  it('adds with one runtime CAS, saves disabled without constructing SDK, and leaves startup config/.env untouched', async () => {
    const f = await fixture(); const pid = process.pid;
    expect(await addCommand.execute(f.context())).toContain('尚未启动');
    expect(f.write).toHaveBeenCalledTimes(1); expect(f.saved().endpoints).toHaveLength(1);
    const account = f.adapter.list()[0]!; expect(account.endpointId).toBe('bot1'); expect(account.desiredEnabled).toBe(false);
    expect(f.adapter.getEndpoint(account.instanceId)).toBeUndefined(); expect(f.source).toEqual({ endpoints: [] });
    expect(f.use).not.toHaveBeenCalled(); expect(process.pid).toBe(pid);
  });
  it('rejects missing required or undeclared input without a CAS', async () => {
    const f = await fixture();
    expect(await addCommand.execute(f.context({ args: [] }))).toContain('缺少必填字段');
    expect(await addCommand.execute(f.context({ args: [...args, 'undeclared=synthetic'] }))).toContain('未声明');
    expect(f.write).not.toHaveBeenCalled(); expect(f.adapter.list()).toEqual([]);
  });
  it('lists the authoritative runtime directory rather than a separate running Map or startup file', async () => {
    const f = await fixture(); await addCommand.execute(f.context({ params: { id: 'conf-bot' } }));
    const text = await listCommand.execute(f.context()); expect(text).toContain('conf-bot');
    expect(text).not.toContain('synthetic-secret'); expect(text).not.toContain('synthetic-token'); expect(f.use).not.toHaveBeenCalled();
  });
  it('removes from the same desired repository without requesting process restart', async () => {
    const f = await fixture(); await addCommand.execute(f.context());
    const text = await removeCommand.execute(f.context()); expect(text).toContain('取消'); expect(text).not.toContain('重启');
    expect(f.saved().endpoints).toHaveLength(0); expect(f.write).toHaveBeenCalledTimes(2); expect(f.source).toEqual({ endpoints: [] });
    expect(f.use).not.toHaveBeenCalled();
  });
  it('retains the configured master guard before either add/remove can reach persistence', async () => {
    const f = await fixture(), denied = f.context({ config: { master: 'alice' }, input: { sender: { id: 'bob' } } });
    expect(await addCommand.execute(denied)).toBe('仅 master 可执行 WeChat MP endpoint 管理命令');
    expect(await removeCommand.execute(denied)).toBe('仅 master 可执行 WeChat MP endpoint 管理命令'); expect(f.write).not.toHaveBeenCalled();
  });
});
