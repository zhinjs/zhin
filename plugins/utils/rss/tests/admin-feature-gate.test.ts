import { AdministratorRssTasks, ADMIN_RSS_STATE_KEY, type AdministratorRssBook } from '../src/admin-tasks.js';
import { resolveRssConfig } from '../src/feed.js';
import { childPluginId, pluginTaskProviderToken, rootPluginId, SnapshotStore } from '../../../../packages/im/plugin-runtime/src/index.js';
import { createTask, target } from './admin-fixture.js';

/** Publishes the provider so its generation admission gate opens (as the Runtime does). */
async function publish(provider: AdministratorRssTasks) {
  const root = rootPluginId(), owner = childPluginId(root, 'rss');
  const snapshots = new SnapshotStore({ root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: '@test/app', packageRoot: '/x', children: [owner] }],
    [owner, { id: owner, instanceKey: 'rss', packageName: '@zhin.js/plugin-rss', packageRoot: '/x', parent: root, children: [] }],
  ]) as never, config: new Map(), resources: new Map([[owner, new Map([[pluginTaskProviderToken.id, provider]])]]) as never,
  capabilities: new Map(), projections: new Map() });
  return snapshots;
}

function memoryState() {
  let value: unknown;
  return {
    async get<T>(key: string): Promise<T | undefined> { expect(key).toBe(ADMIN_RSS_STATE_KEY); return structuredClone(value) as T | undefined; },
    async update<T>(_key: string, next: (current: T | undefined) => T | undefined): Promise<T | undefined> {
      value = structuredClone(next(structuredClone(value) as T | undefined)); return structuredClone(value) as T | undefined;
    },
  };
}

const feed = (...ids: string[]) => ({ title: 'Source', items: ids.map(guid => ({ guid, title: `Article ${guid}`, summary: '', link: `https://example.test/${guid}`, date: '' })) });

describe('administrator RSS feature gate (ADR 0050 / 0055)', () => {
  it('skips delivery to a target conversation where rss is switched off and records featureDisabled', async () => {
    const state = memoryState();
    const send = vi.fn(async () => 'message-id');
    let enabled = false;
    const checked: unknown[] = [];
    const load = vi.fn().mockResolvedValue(feed('base'));
    const provider = new AdministratorRssTasks(state as never, { send, sendTarget: send }, resolveRssConfig({}), load, 'zh-CN',
      destination => { checked.push(destination); return enabled; });
    const snapshots = await publish(provider);
    await createTask(provider);
    await provider.tick(); // baseline
    load.mockResolvedValue(feed('new-1', 'base'));
    await provider.tick();
    expect(send).not.toHaveBeenCalled();
    expect(checked).toEqual([target]);
    const book = await state.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY);
    expect(book!.tasks[0]).toMatchObject({ state: 'scheduled', detailKey: 'featureDisabled' });
    // Re-enabled: only later articles are delivered (the skipped one is not backfilled).
    enabled = true;
    load.mockResolvedValue(feed('new-2', 'new-1', 'base'));
    await provider.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toContain('Article new-2');
    expect(send.mock.calls[0]![1]).not.toContain('Article new-1');
    expect((await state.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY))!.tasks[0]).toMatchObject({ state: 'scheduled', detailKey: 'delivered' });
    provider.stop(); await snapshots.close();
  });
});
