import { Endpoint, bindEndpoint, endpointEventGatewayToken, retireEndpoint } from '../src/endpoint.js';
import { materializeEndpoint } from '../src/managed-endpoint.js';
import { getProcessPeerRegistry } from '../src/peer-registry.js';

class TestEndpoint extends Endpoint<object> {
  readonly client = {};
  start(): void {}
  open(): void {}
  close(): void {}
  stop(): void {}
  report(id: unknown): void { this.reportSelfUserId(id as never); }
}

function fakeAdmission() {
  let activate: (() => void) | undefined;
  let deactivate: (() => void) | undefined;
  return {
    gate: {
      onActivate: (fn: () => void) => { activate = fn; },
      onDeactivate: (fn: () => void) => { deactivate = fn; },
    } as never,
    activate: () => activate?.(),
    deactivate: () => deactivate?.(),
  };
}

let counter = 0;
const nextId = () => `self-id-test-${++counter}`;
const ctx = (id: string) => ({
  id,
  name: 'Fake',
  use: (token: unknown) => token === endpointEventGatewayToken ? { receive: async () => undefined } : undefined,
}) as never;
const registry = getProcessPeerRegistry();

describe('Endpoint.selfUserId', () => {
  it('registers immediately when bound without admission', () => {
    const id = nextId();
    const endpoint = new TestEndpoint();
    bindEndpoint(endpoint, ctx(id));
    expect(endpoint.selfUserId).toBeUndefined();
    endpoint.report(12345);
    expect(endpoint.selfUserId).toBe('12345');
    expect(registry.selfOf(id)).toBe('12345');
    expect(registry.lookup('fake', '12345')?.endpointIds).toEqual([id]);
    retireEndpoint(endpoint);
    expect(registry.isReady(id)).toBe(false);
  });

  it('stays out of the registry while pending, registers on activate, removes on deactivate', () => {
    const id = nextId();
    const admission = fakeAdmission();
    const endpoint = new TestEndpoint();
    bindEndpoint(endpoint, ctx(id), admission.gate);
    endpoint.report('777');
    expect(registry.isReady(id)).toBe(false);
    admission.activate();
    expect(registry.selfOf(id)).toBe('777');
    admission.deactivate();
    expect(registry.isReady(id)).toBe(false);
  });

  it('never registers a rolled-back candidate', () => {
    const id = nextId();
    const admission = fakeAdmission();
    const endpoint = new TestEndpoint();
    bindEndpoint(endpoint, ctx(id), admission.gate);
    endpoint.report('777');
    retireEndpoint(endpoint);
    admission.activate();
    expect(registry.isReady(id)).toBe(false);
  });

  it('registers a report made before bind once bound', () => {
    const id = nextId();
    const endpoint = new TestEndpoint();
    endpoint.report('55');
    expect(registry.isReady(id)).toBe(false);
    bindEndpoint(endpoint, ctx(id));
    expect(registry.selfOf(id)).toBe('55');
    retireEndpoint(endpoint);
  });

  it('fails closed on invalid values and revokes on undefined', () => {
    const id = nextId();
    const endpoint = new TestEndpoint();
    bindEndpoint(endpoint, ctx(id));
    for (const bad of ['', '  ', undefined, null, NaN, {}]) {
      endpoint.report(bad);
      expect(endpoint.selfUserId).toBeUndefined();
      expect(registry.isReady(id)).toBe(false);
    }
    endpoint.report('9');
    expect(registry.isReady(id)).toBe(true);
    endpoint.report(undefined);
    expect(registry.isReady(id)).toBe(false);
    retireEndpoint(endpoint);
  });

  it('replaces on re-login and does not let an old instance delete the new one', () => {
    const id = nextId();
    const oldEndpoint = new TestEndpoint();
    const newEndpoint = new TestEndpoint();
    bindEndpoint(oldEndpoint, ctx(id));
    oldEndpoint.report('1');
    bindEndpoint(newEndpoint, ctx(id));
    newEndpoint.report('2');
    expect(registry.selfOf(id)).toBe('2');
    retireEndpoint(oldEndpoint);
    expect(registry.selfOf(id)).toBe('2');
    retireEndpoint(newEndpoint);
    expect(registry.isReady(id)).toBe(false);
  });

  it('keeps identity frozen and unchanged', () => {
    const endpoint = new TestEndpoint();
    bindEndpoint(endpoint, ctx(nextId()));
    endpoint.report('1');
    expect(Object.isFrozen(endpoint.identity)).toBe(true);
    expect(Object.keys(endpoint.identity).sort()).toEqual(['adapter', 'id']);
    retireEndpoint(endpoint);
  });
});

describe('materialized Endpoint self reporting', () => {
  it('reports through the activation context', async () => {
    const id = nextId();
    let reporter: ((id: string | undefined) => void) | undefined;
    const endpoint = materializeEndpoint({
      client: {},
      activate: (context) => { reporter = context.reportSelfUserId; },
    }, { id: id as never, endpointId: id });
    bindEndpoint(endpoint, ctx(id));
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    reporter!('4242');
    expect(endpoint.selfUserId).toBe('4242');
    expect(registry.selfOf(id)).toBe('4242');
    await endpoint.stop();
    retireEndpoint(endpoint);
    expect(registry.isReady(id)).toBe(false);
  });

  it('reads the optional selfUserId getter after open and ignores a failing getter', async () => {
    const id = nextId();
    const good = materializeEndpoint({ client: {}, selfUserId: '88' }, { id: id as never, endpointId: id });
    bindEndpoint(good, ctx(id));
    await good.start(new AbortController().signal);
    good.open();
    expect(registry.selfOf(id)).toBe('88');
    retireEndpoint(good);

    const id2 = nextId();
    const bad = materializeEndpoint({
      client: {},
      get selfUserId(): string { throw new Error('boom'); },
    }, { id: id2 as never, endpointId: id2 });
    bindEndpoint(bad, ctx(id2));
    await bad.start(new AbortController().signal);
    expect(() => bad.open()).not.toThrow();
    expect(registry.isReady(id2)).toBe(false);
    retireEndpoint(bad);
  });
});
