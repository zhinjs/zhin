import { describe, expect, it } from 'vitest';
import {
  defineHandler,
  parseHandlerDefinition,
  HandlerIndex,
  isHandlerIndex,
  handlerEventFromLocalName,
  resolveHandlerEvent,
  handlerFeatureId,
  handlerFeature,
  type HandlerDefinition,
} from '../src/index.js';
import { operationInputBinding, operationSession, type OperationSession, type DirectoryEntry, type DiscoveryHost } from '@zhin.js/feature-kit';
import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';

// ---------------------------------------------------------------------------
// defineHandler
// ---------------------------------------------------------------------------

describe('defineHandler', () => {
  it('creates a branded handler definition with explicit event', () => {
    const handler = defineHandler({
      event: 'message.receive',
      handle(msg) { /* noop */ },
    });
    expect(handler.$feature).toBe('zhin.handler/1');
    expect(handler.event).toBe('message.receive');
    expect(typeof handler.handle).toBe('function');
    expect(Object.isFrozen(handler)).toBe(true);
  });

  it('creates a handler without event (inferred from convention path)', () => {
    const handler = defineHandler({
      handle() { /* noop */ },
    });
    expect(handler.$feature).toBe('zhin.handler/1');
    expect(handler.event).toBeUndefined();
  });

  it('throws on non-function handle', () => {
    expect(() => defineHandler({ handle: 'not-a-function' as never }))
      .toThrow('Handler handle must be a function');
  });

  it('throws on empty string event', () => {
    expect(() => defineHandler({ event: '', handle() {} }))
      .toThrow('Handler event must be a non-empty string');
  });

  it('throws on non-string event', () => {
    expect(() => defineHandler({ event: 42 as never, handle() {} }))
      .toThrow('Invalid Handler event');
  });
});

// ---------------------------------------------------------------------------
// parseHandlerDefinition
// ---------------------------------------------------------------------------

describe('parseHandlerDefinition', () => {
  it('accepts a valid branded definition', () => {
    const handler = defineHandler({ event: 'test.event', handle() {} });
    expect(parseHandlerDefinition(handler)).toBe(handler);
  });

  it('rejects non-objects', () => {
    expect(() => parseHandlerDefinition(null)).toThrow(/default-export defineHandler/);
    expect(() => parseHandlerDefinition(42)).toThrow(/default-export defineHandler/);
  });

  it('rejects wrong brand', () => {
    expect(() => parseHandlerDefinition({ $feature: 'wrong', handle() {} }))
      .toThrow(/default-export defineHandler/);
  });

  it('rejects missing handle', () => {
    expect(() => parseHandlerDefinition({ $feature: 'zhin.handler/1' }))
      .toThrow(/default-export defineHandler/);
  });
});

// ---------------------------------------------------------------------------
// HandlerIndex
// ---------------------------------------------------------------------------

function createSnapshot(pluginId: string = 'test-plugin'): RuntimeSnapshot {
  const owner = pluginId as PluginId;
  return {
    generation: 1,
    root: owner,
    tree: new Map([[owner, {
      id: owner,
      instanceKey: 'key',
      packageName: 'test',
      parent: undefined,
      children: [],
      role: 'root' as const,
    }]]),
    config: new Map([[owner, {}]]),
    resources: new Map([[owner, new Map()]]),
    capabilities: new Map(),
    projections: new Map(),
  } as unknown as RuntimeSnapshot;
}

function createSlot(
  localName: string,
  definition: HandlerDefinition,
  owner = 'test-plugin' as PluginId,
): Readonly<CapabilitySlot<HandlerDefinition>> {
  return Object.freeze({
    id: `slot-${localName}` as never,
    owner,
    localName,
    source: `/handlers/${localName}/index.ts`,
    definition,
  });
}

describe('handlerEventFromLocalName', () => {
  it('maps / capability segments to Lifecycle event dots', () => {
    expect(handlerEventFromLocalName('notice/receive')).toBe('notice.receive');
    expect(handlerEventFromLocalName('ai/tool/call')).toBe('ai.tool.call');
    expect(handlerEventFromLocalName('message-receive')).toBe('message-receive');
  });
});

describe('resolveHandlerEvent', () => {
  it('prefers explicit event over localName mapping', () => {
    expect(resolveHandlerEvent('notice/receive', 'custom.event')).toBe('custom.event');
  });

  it('infers event from localName when omitted', () => {
    expect(resolveHandlerEvent('notice/receive', undefined)).toBe('notice.receive');
  });
});

describe('HandlerIndex', () => {
  it('exposes the bound Session through the actual dispatch context and filters platform handlers', async () => {
    const snapshot = createSnapshot();
    const session: OperationSession<'handler-test'> = { adapterName: 'handler-test', adapter: {}, endpoint: {},
      scene: { endpoint: { adapter: 'owner', id: 'canonical' }, kind: 'private', id: 'speaker' },
      message: { text: 'original', receivedAt: 100 }, event: new Map([['original', true]]),
      signal: new AbortController().signal, reply: async () => undefined };
    const seen: unknown[] = [];
    const handler = defineHandler({ adapter: 'handler-test', event: 'session.message', handle(event) {
      seen.push(this.session); expect(event).toBe(source); expect(this.session).toBe(session);
      expect(Reflect.set(this, 'session', undefined)).toBe(false);
    } });
    const index = new HandlerIndex([createSlot('session/message', handler)], snapshot);
    const source = { payload: { [operationSession]: () => session } };
    await index.dispatch('session.message', [source]);
    await index.dispatch('session.message', [{ payload: { [operationSession]: () => ({ ...session, adapterName: 'other' }) } }]);
    expect(seen).toEqual([session]);
  });

  it('rebinds Session reply authority to each handler owner without changing the event envelope', async () => {
    const first = createSnapshot();
    const secondOwner = 'second-handler' as PluginId;
    const snapshot: RuntimeSnapshot = { ...first, tree: new Map([...first.tree, [secondOwner, { ...first.tree.get(first.root)!, id: secondOwner }]]),
      config: new Map([...first.config, [secondOwner, {}]]), resources: new Map([...first.resources, [secondOwner, new Map()]]) };
    const replies: string[] = [];
    const bindingOwners: string[] = [];
    const interactionOwners: string[] = [];
    const payload = { message: 'same native envelope' };
    const session: OperationSession<'handler-test'> = { adapterName: 'handler-test', adapter: {}, endpoint: {},
      scene: { endpoint: { adapter: 'owner', id: 'canonical' }, kind: 'private', id: 'speaker' },
      message: { text: 'hello', receivedAt: 100 }, event: payload, signal: new AbortController().signal,
      reply: async () => { replies.push('adapter-owner'); } };
    const source = { payload, [operationSession]: () => session,
      [operationInputBinding](owner: PluginId, actual: RuntimeSnapshot) {
        expect(actual).toBe(snapshot); bindingOwners.push(owner);
        return { payload, [operationSession]: () => ({ ...session, reply: async () => { replies.push(owner); } }) };
      } };
    const definition = defineHandler({ event: 'session.message', async handle(event) {
      expect(event).toMatchObject({ payload });
      expect(this.session?.event).toBe(payload);
      await this.session!.reply('answer');
    } });
    const index = new HandlerIndex([createSlot('first', definition), createSlot('second', definition, secondOwner)], snapshot);
    await index.dispatch('session.message', [source], { resolveInteraction(_event, args, owner) {
      interactionOwners.push(owner); expect(args[0]).not.toBe(source); return undefined;
    } });
    expect(bindingOwners).toEqual([first.root, secondOwner]);
    expect(interactionOwners).toEqual([first.root, secondOwner]);
    expect(replies).toEqual([first.root, secondOwner]);
  });

  it('passes the indexed owner to the internal interaction factory', async () => {
    const snapshot = createSnapshot();
    const received: unknown[] = [];
    const index = new HandlerIndex([createSlot('test/event', defineHandler({ event: 'test.event', handle() {} }))], snapshot);
    await index.dispatch('test.event', ['payload'], {
      resolveInteraction(event, args, owner) { received.push({ event, args, owner }); return undefined; },
    });
    expect(received).toEqual([{ event: 'test.event', args: ['payload'], owner: 'test-plugin' }]);
  });
  it('indexes handlers by event name from definition.event', () => {
    const h1 = defineHandler({ event: 'message.receive', handle() {} });
    const h2 = defineHandler({ event: 'endpoint.connect', handle() {} });
    const snapshot = createSnapshot();

    const index = new HandlerIndex(
      [createSlot('message/receive', h1), createSlot('endpoint/connect', h2)],
      snapshot,
    );

    expect(index.events()).toEqual(expect.arrayContaining(['message.receive', 'endpoint.connect']));
    expect(index.has('message.receive')).toBe(true);
    expect(index.has('endpoint.connect')).toBe(true);
    expect(index.has('unknown.event')).toBe(false);
  });

  it('maps path localName to dotted event when definition.event is omitted', () => {
    const handler = defineHandler({ handle() {} });
    const snapshot = createSnapshot();

    const index = new HandlerIndex(
      [createSlot('ai/tool/call', handler)],
      snapshot,
    );

    expect(index.has('ai.tool.call')).toBe(true);
    expect(index.has('ai/tool/call')).toBe(false);
  });

  it('dispatches to matching handlers', async () => {
    const called: unknown[][] = [];
    const handler = defineHandler({
      event: 'test.event',
      handle(...args: unknown[]) { called.push(args); },
    });
    const snapshot = createSnapshot();
    const index = new HandlerIndex([createSlot('test/event', handler)], snapshot);

    await index.dispatch('test.event', ['arg1', 'arg2']);
    expect(called).toEqual([['arg1', 'arg2']]);
  });

  it('dispatches nothing for unknown events', async () => {
    const snapshot = createSnapshot();
    const index = new HandlerIndex([], snapshot);
    await expect(index.dispatch('unknown')).resolves.toBeUndefined();
  });

  it('dispatches to multiple handlers for the same event', async () => {
    const order: number[] = [];
    const h1 = defineHandler({ event: 'test', handle() { order.push(1); } });
    const h2 = defineHandler({ event: 'test', handle() { order.push(2); } });
    const snapshot = createSnapshot();

    const index = new HandlerIndex(
      [createSlot('a', h1), createSlot('b', h2)],
      snapshot,
    );

    await index.dispatch('test');
    expect(order).toEqual([1, 2]);
  });

  it('list() returns descriptors without internal slot', () => {
    const handler = defineHandler({ event: 'foo.bar', handle() {} });
    const snapshot = createSnapshot();
    const index = new HandlerIndex([createSlot('foo/bar', handler)], snapshot);

    const descriptors = index.list();
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toEqual({
      owner: 'test-plugin',
      name: 'foo/bar',
      source: '/handlers/foo/bar/index.ts',
      event: 'foo.bar',
    });
    expect((descriptors[0] as Record<string, unknown>).slot).toBeUndefined();
  });

  it('list() infers event from slash localName when event omitted', () => {
    const handler = defineHandler({ handle() {} });
    const snapshot = createSnapshot();
    const index = new HandlerIndex([createSlot('notice/receive', handler)], snapshot);

    expect(index.list()).toEqual([{
      owner: 'test-plugin',
      name: 'notice/receive',
      source: '/handlers/notice/receive/index.ts',
      event: 'notice.receive',
    }]);
  });

});

// ---------------------------------------------------------------------------
// isHandlerIndex
// ---------------------------------------------------------------------------

describe('isHandlerIndex', () => {
  it('returns true for HandlerIndex instances', () => {
    const snapshot = createSnapshot();
    const index = new HandlerIndex([], snapshot);
    expect(isHandlerIndex(index)).toBe(true);
  });

  it('returns false for non-HandlerIndex values', () => {
    expect(isHandlerIndex(null)).toBe(false);
    expect(isHandlerIndex({})).toBe(false);
    expect(isHandlerIndex({ $projection: 'wrong' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler convention
// ---------------------------------------------------------------------------

describe('directoryModules for handlers', () => {
  it('discovers one named directory per handler', async () => {
    const sources = await discoverHandlers('/workspace/plugin', {
      'handlers': [
        { name: 'message-receive', kind: 'directory' },
      ],
      'handlers/message-receive': [
        { name: 'index.ts', kind: 'file' },
      ],
    });

    expect(sources).toEqual([
      { localName: 'message-receive', source: '/workspace/plugin/handlers/message-receive/index.ts' },
    ]);
  });

  it('ignores helpers and nested directories inside a handler module', async () => {
    const sources = await discoverHandlers('/workspace/plugin', {
      'handlers': [
        { name: 'ai-tool-call', kind: 'directory' },
      ],
      'handlers/ai-tool-call': [
        { name: 'index.ts', kind: 'file' },
        { name: 'helper.ts', kind: 'file' },
        { name: 'private', kind: 'directory' },
      ],
    });

    expect(sources).toEqual([
      { localName: 'ai-tool-call', source: '/workspace/plugin/handlers/ai-tool-call/index.ts' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// handlerFeature provider
// ---------------------------------------------------------------------------

describe('handlerFeature', () => {
  it('has correct feature id and convention', () => {
    expect(handlerFeatureId).toBe('zhin.handler');
    expect(handlerFeature.protocol).toBe(1);
    expect(handlerFeature.id).toBe(handlerFeatureId);
    expect(handlerFeature.authoring.setupMethod).toBe('addHandler');
    expect(handlerFeature.authoring.conventions).toHaveLength(1);
    expect(handlerFeature.authoring.conventions[0].id).toBe('handlers-index');
  });

  it('validate accepts valid handler definitions', () => {
    const handler = defineHandler({ event: 'test', handle() {} });
    expect(handlerFeature.authoring.validate(handler, {
      owner: 'p' as never,
      feature: handlerFeatureId,
      localName: 'test',
      source: '/test.ts',
    })).toBe(handler);
  });

  it('validate rejects invalid definitions', () => {
    expect(() => handlerFeature.authoring.validate({}, {
      owner: 'p' as never,
      feature: handlerFeatureId,
      localName: 'test',
      source: '/test.ts',
    })).toThrow(/default-export defineHandler/);
  });

  it('project returns a HandlerIndex', () => {
    const snapshot = createSnapshot();
    const handler = defineHandler({ event: 'test', handle() {} });
    const projection = handlerFeature.runtime.project(
      [createSlot('test', handler)],
      { snapshot, signal: new AbortController().signal },
    );
    expect(isHandlerIndex((projection as { value: unknown }).value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function discoverHandlers(
  packageRoot: string,
  tree: Record<string, readonly DirectoryEntry[]>,
): Promise<Array<{ localName: string; source: string }>> {
  const host: DiscoveryHost = {
    async list(directory) {
      const key = directory.replace(`${packageRoot}/`, '');
      return tree[key] ?? [];
    },
    async loadModule<T>() { return {} as T; },
    async readText() { return ''; },
  };
  const convention = handlerFeature.authoring.conventions[0];
  const sources: Array<{ localName: string; source: string }> = [];
  for await (const source of convention.discover({
    owner: 'root' as never,
    packageRoot,
    host,
  })) {
    sources.push({ localName: source.localName, source: source.source });
  }
  return sources;
}

// The test platform registers its Adapter once, just like an installed platform declaration.
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'handler-test': { readonly adapterEvents: Record<string, unknown>; getEndpoint(instance: string): object | undefined } }
}
declare module '../src/definition.js' { interface HandlerEventMap { 'session.message': [event: unknown] } }
