import { describe, expect, it, vi } from 'vitest';
import { PermissionHost, describeDeniedPermit, permissionHostToken } from '@zhin.js/permission';
import { adapterFeatureId } from '@zhin.js/adapter';
import { rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { JsxButtonRegistry } from '../../src/plugin-runtime/im/interactive-router.js';
import { inboundOutcomeSink } from '../../src/plugin-runtime/im/inbound-outcome-ledger.js';

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

function click(sender: Record<string, unknown>, at: { readonly kind: string } = conversation) {
  const replies: unknown[] = [];
  const outcomes: unknown[] = [];
  const sink = { report: (candidate: unknown) => { outcomes.push(candidate); return true; }, enter() {} };
  return { replies, outcomes, message: { conversation: at, sender, locale: 'zh-CN', $reply: async (content: unknown) => { replies.push(content); },
    [inboundOutcomeSink]: () => sink } as never };
}

describe('<Button permit> (ADR 0056 §5: the clicker is checked by the shared evaluator)', () => {
  it('runs the callback only for clickers meeting the permit; others are refused silently in a group (#1250)', async () => {
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
    expect(member.replies).toEqual([]);
    expect(member.outcomes).toEqual([{ outcome: 'permission_denied', reason: 'button_permit', stage: 'interaction', reply: 'no' }]);

    const admin = click({ id: 'a', platform: { standing: 'admin' } });
    await registry.dispatch(admin.message, payload, current);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('tells a clicker in a private chat why the button is refused (#1250)', async () => {
    const host = new PermissionHost();
    const current = snapshot(host);
    const registry = new JsxButtonRegistry();
    const onClick = vi.fn(() => '已处理');
    const dm = { endpoint: conversation.endpoint, kind: 'private' as const, id: 'm' };
    const batch = registry.prepare({ requester: root, conversation: dm } as never, current);
    const payload = (batch.bind({ label: '处理', onClick, permit: ['admin'] }) as { data: { rows: { payload: string }[][] } }).data.rows[0]![0]!.payload;
    batch.activate(new Set([payload]));
    const member = click({ id: 'm' }, dm);
    expect(await registry.dispatch(member.message, payload, current)).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    expect(JSON.stringify(member.replies)).toContain('你不能使用这个按钮');
    expect(member.outcomes).toEqual([{ outcome: 'permission_denied', reason: 'button_permit', stage: 'interaction', reply: 'yes' }]);
  });

  it('points a Sandbox-only project at the Sandbox identity when an owner@global button is refused (#1250 b116)', async () => {
    const host = new PermissionHost();
    const simulation = { default: { delivery: { send: true }, runtime: { sandbox: true } } };
    const adapters = { $projection: 'zhin.adapter-index/1', describe: () => [{ id: 'sandbox' }], capabilityProfile: () => simulation };
    const current = { ...snapshot(host), projections: new Map([[adapterFeatureId, adapters]]) } as unknown as RuntimeSnapshot;
    const registry = new JsxButtonRegistry();
    const onClick = vi.fn(() => 'x');
    const dm = { endpoint: conversation.endpoint, kind: 'private' as const, id: 'm' };
    const batch = registry.prepare({ requester: root, conversation: dm } as never, current);
    const payload = (batch.bind({ label: 'x', onClick, permit: ['owner@global'] }) as { data: { rows: { payload: string }[][] } }).data.rows[0]![0]!.payload;
    batch.activate(new Set([payload]));
    const member = click({ id: 'm' }, dm);
    await registry.dispatch(member.message, payload, current);
    expect(onClick).not.toHaveBeenCalled();
    const reply = JSON.stringify(member.replies);
    expect(reply).toContain(JSON.stringify(describeDeniedPermit('owner@global', 'zh-CN', { simulationOnly: true })).slice(1, -1));
    expect(reply).not.toContain(JSON.stringify(describeDeniedPermit('owner@global', 'zh-CN')).slice(1, -1));
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
