import { EventEmitter } from 'node:events';
import * as api from '../src/index.js';

class NativeClient extends EventEmitter {
  start(value: string): string { return `sdk:${value}`; }
  send(value: string): number { return value.length; }
}
class NativeEndpoint extends NativeClient {
  readonly [api.endpointSpec] = api.createEndpointSpecification(this, {
    start: () => undefined, open: () => undefined, close: () => undefined,
    stop: () => undefined, send: async () => 'message-id',
  });
}
class NativeAdapter extends api.Adapter<NativeEndpoint> {
  protected createEndpoint(): NativeEndpoint { return new NativeEndpoint(); }
}
const definition = () => ({ capabilities: ['inbound', 'outbound'], createAdapter: () => new NativeAdapter() });

describe('single target Adapter authoring contract', () => {
  it('rejects the removed create factory at the public JavaScript boundary', () => {
    expect(() => Reflect.apply(api.defineAdapter, undefined, [{ capabilities: ['inbound'], create: () => ({}) }])).toThrow(/createAdapter/);
  });
  it('rejects a mixed factory instead of retaining an ignored legacy branch', () => {
    expect(() => Reflect.apply(api.defineAdapter, undefined, [{ ...definition(), create: () => ({}) }])).toThrow(/create/);
  });
  it('rejects removed factories in convention-discovered JavaScript modules', () => {
    expect(() => api.parseAdapterDefinition({ $feature: 'zhin.adapter/1', capabilities: ['inbound'], create: () => ({}) })).toThrow();
  });
  it('keeps only the Adapter factory and the structural Endpoint interface public', () => {
    expect(Reflect.get(api, 'Endpoint')).toBeUndefined();
    expect(Reflect.get(api, 'ClientEndpoint')).toBeUndefined();
    expect(Reflect.get(api, 'materializeEndpoint')).toBeUndefined();
    expect(Reflect.get(api, 'endpointClientOf')).toBeUndefined();
    expect(Reflect.get(api, 'defineEndpointClient')).toBeUndefined();
  });
  it('recognizes the actual SDK subclass without a Client wrapper', () => {
    const endpoint = new NativeEndpoint();
    expect(api.isEndpoint(endpoint)).toBe(true);
    expect(endpoint).toBeInstanceOf(NativeClient);
    expect(endpoint.start('native')).toBe('sdk:native');
    expect(endpoint.send('native')).toBe(6);
    const listener = vi.fn(); endpoint.on('native', listener); endpoint.emit('native', 'event');
    expect(listener).toHaveBeenCalledOnce(); expect(listener).toHaveBeenCalledWith('event');
  });
  it('keeps framework operations in their own namespace', () => {
    const spec = new NativeEndpoint()[api.endpointSpec];
    expect(typeof Reflect.get(spec, 'resolveLocale')).toBe('function');
    expect(typeof Reflect.get(spec.events, 'emitAccepted')).toBe('function');
    expect(Reflect.get(spec, 'start')).toBeUndefined();
    expect(Reflect.get(spec, 'send')).toBeUndefined();
  });
});
