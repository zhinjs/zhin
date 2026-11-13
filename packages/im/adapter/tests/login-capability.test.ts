import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import {
  Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec, endpointEventGatewayToken,
  normalizeLoginDeclaration, type AdapterLoginDeclaration, type Endpoint, type EndpointLoginControl,
} from '../src/index.js';

class LoginEndpoint extends EventEmitter implements Endpoint {
  readonly [endpointSpec];
  constructor(login?: EndpointLoginControl, start: (signal: AbortSignal) => void | Promise<void> = () => {}) {
    super();
    this[endpointSpec] = createEndpointSpecification(this, { start, open() {}, close() {}, stop() {}, ...(login ? { login } : {}) });
  }
}
class LoginAdapter extends Adapter<LoginEndpoint> {
  constructor(readonly endpoint: LoginEndpoint) { super(); }
  protected createEndpoint(): LoginEndpoint { return this.endpoint; }
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(endpoint: LoginEndpoint, login?: AdapterLoginDeclaration, options: { awaitStart?: boolean } = {}) {
  const owner = rootPluginId();
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'fake', source: '/fixture/adapters/fake/index.ts',
    definition: defineAdapter({ capabilities: ['inbound'], ...(login ? { login } : {}), createAdapter: () => new LoginAdapter(endpoint) }) });
  const state: SnapshotState = { root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive: async () => undefined }]])]]), capabilities: new Map([[slot.id, slot]]), projections: new Map() };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  const starting = index.start();
  if (options.awaitStart !== false) await starting;
  else starting.catch(() => undefined);
  cleanup.push(() => index.stop());
  return { index, id: index.describe()[0]!.id, starting };
}

describe('Adapter login declaration (ADR 0058)', () => {
  it('validates and freezes the declaration', () => {
    expect(normalizeLoginDeclaration(undefined)).toBeUndefined();
    expect(normalizeLoginDeclaration({ mode: 'interactive', challenges: ['qrcode', 'qrcode', 'sms'], relogin: true }))
      .toEqual({ mode: 'interactive', challenges: ['qrcode', 'sms'], relogin: true });
    expect(() => normalizeLoginDeclaration({ mode: 'password' } as never)).toThrow(/mode/u);
    expect(() => normalizeLoginDeclaration({ mode: 'interactive', challenges: ['captcha'] } as never)).toThrow(/challenges/u);
    expect(() => normalizeLoginDeclaration({ mode: 'external', relogin: 'yes' } as never)).toThrow(/relogin/u);
    expect(() => defineAdapter({ capabilities: ['inbound'], login: { mode: 'nope' } as never, createAdapter: () => new LoginAdapter(new LoginEndpoint()) }))
      .toThrow(/Adapter login/u);
  });

  it('exposes the declaration and a scoped login control port through the Adapter index', async () => {
    const control: EndpointLoginControl = { relogin: vi.fn(async () => {}) };
    const { index, id } = await fixture(new LoginEndpoint(control), { mode: 'interactive', relogin: true });
    expect(index.loginDeclaration(id)).toEqual({ mode: 'interactive', relogin: true });
    const port = index.loginControl(id)!;
    expect(port.refreshChallenge).toBeUndefined();
    await port.relogin!({});
    expect(control.relogin).toHaveBeenCalledTimes(1);
    expect((control.relogin as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveProperty('signal');
  });

  it('absent declaration and hooks mean unsupported', async () => {
    const { index, id } = await fixture(new LoginEndpoint());
    expect(index.loginDeclaration(id)).toBeUndefined();
    expect(index.loginControl(id)).toBeUndefined();
  });

  it('reaches the login hooks while start is blocked on a login challenge, and refuses them once stopped', async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const control: EndpointLoginControl = { relogin: vi.fn(async () => {}), refreshChallenge: vi.fn(async () => {}) };
    // start() waits for a login that never completes (the person has not scanned yet).
    const endpoint = new LoginEndpoint(control, (signal) => new Promise<void>((_resolve, reject) => {
      started();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const { index, id } = await fixture(endpoint, { mode: 'interactive', relogin: true, refreshQr: true }, { awaitStart: false });
    await entered;
    expect(index.describe()[0]).toMatchObject({ phase: 'starting' });
    // Other ports stay closed until start completes.
    expect(() => index.acquire(id)).toThrow(expect.objectContaining({ code: 'endpoint_inactive' }));
    const port = index.loginControl(id)!;
    await port.refreshChallenge!({});
    await port.relogin!({});
    expect(control.refreshChallenge).toHaveBeenCalledTimes(1);
    expect(control.relogin).toHaveBeenCalledTimes(1);

    // Stopping the Index retires the incarnation and disposes the Adapter: the captured port is refused.
    await index.stop();
    const refused = await port.relogin!({}).then(() => undefined, (error: unknown) => error as { code?: string });
    expect(['endpoint_inactive', 'closed']).toContain(refused?.code);
    expect(control.relogin).toHaveBeenCalledTimes(1);
  });
});
