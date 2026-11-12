import { describe, expect, it, vi } from 'vitest';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { JsxButtonRegistry } from '../../src/plugin-runtime/im/interactive-router.js';

const root = rootPluginId();
const conversation = { endpoint: { id: 'ep', adapter: 'test' }, kind: 'group' as const, id: 'g1' };

function snapshot(host?: PermissionHost): RuntimeSnapshot {
  return {
    generation: 1, root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@t/root', packageRoot: '/p', children: [] }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map(host ? [[permissionHostToken.id, host]] : [])]]),
    capabilities: new Map(), projections: new Map(),
  } as unknown as RuntimeSnapshot;
}

function click(sender: Record<string, unknown>) {
  const replies: unknown[] = [];
  return { replies, message: { conversation, sender, locale: 'zh-CN', $reply: async (content: unknown) => { replies.push(content); } } as never };
}

describe('<Button permit> (ADR 0056 §5: the clicker is checked by the shared evaluator)', () => {
  it('runs the callback only for clickers meeting the permit and tells others why', async () => {
    const host = new PermissionHost();
    const current = snapshot(host);
    const registry = new JsxButtonRegistry();
    const onClick = vi.fn(() => '已处理');
    const batch = registry.prepare({ requester: root, conversation } as never, current);
    const segment = batch.bind({ label: '处理', onClick, permit: ['platform:admin'] }) as { data: { rows: { payload: string }[][] } };
    const payload = segment.data.rows[0]![0]!.payload;
    expect(JSON.stringify(segment)).not.toContain('permit');
    batch.activate(new Set([payload]));

    const member = click({ id: 'm' });
    expect(await registry.dispatch(member.message, payload, current)).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    expect(JSON.stringify(member.replies)).toContain('你不能使用这个按钮：需要你是本群群主或管理员。');

    const admin = click({ id: 'a', platform: { standing: 'admin' } });
    await registry.dispatch(admin.message, payload, current);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fails closed without a Permission host and rejects removed spellings or payload buttons', async () => {
    const current = snapshot();
    const registry = new JsxButtonRegistry();
    const onClick = vi.fn(() => 'x');
    const batch = registry.prepare({ requester: root, conversation } as never, current);
    const payload = (batch.bind({ label: 'x', onClick, permit: ['owner'] }) as { data: { rows: { payload: string }[][] } }).data.rows[0]![0]!.payload;
    batch.activate(new Set([payload]));
    await registry.dispatch(click({ id: 'o', chatRole: 'owner' }).message, payload, current);
    expect(onClick).not.toHaveBeenCalled();
    expect(() => batch.bind({ label: 'y', onClick, permit: ['scene_admin'] })).toThrow(/removed/u);
    expect(() => batch.bind({ label: 'z', payload: 'p', permit: ['owner'] } as never)).toThrow(/onClick/u);
  });
});
