import { describe, expect, it, vi } from 'vitest';
import {
  defineHandler,
  parseHandlerDefinition,
  HandlerIndex,
  isHandlerIndex,
  handlerFeatureId,
  handlerFeature,
  typeScriptModules,
  type DirectoryEntry,
  type DiscoveryHost,
} from '../src/index.js';
import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { HandlerDefinition } from '../src/handler.js';

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
    source: `/handlers/${localName.replace(/\./g, '/')}.ts`,
    definition,
  });
}

describe('HandlerIndex', () => {
  it('indexes handlers by event name from definition.event', () => {
    const h1 = defineHandler({ event: 'message.receive', handle() {} });
    const h2 = defineHandler({ event: 'endpoint.connect', handle() {} });
    const snapshot = createSnapshot();

    const index = new HandlerIndex(
      [createSlot('message.receive', h1), createSlot('endpoint.connect', h2)],
      snapshot,
    );

    expect(index.events()).toEqual(expect.arrayContaining(['message.receive', 'endpoint.connect']));
    expect(index.has('message.receive')).toBe(true);
    expect(index.has('endpoint.connect')).toBe(true);
    expect(index.has('unknown.event')).toBe(false);
  });

  it('falls back to localName when definition.event is omitted', () => {
    const handler = defineHandler({ handle() {} });
    const snapshot = createSnapshot();

    const index = new HandlerIndex(
      [createSlot('ai.tool.call', handler)],
      snapshot,
    );

    expect(index.has('ai.tool.call')).toBe(true);
  });

  it('dispatches to matching handlers', async () => {
    const called: unknown[][] = [];
    const handler = defineHandler({
      event: 'test.event',
      handle(...args: unknown[]) { called.push(args); },
    });
    const snapshot = createSnapshot();
    const index = new HandlerIndex([createSlot('test.event', handler)], snapshot);

    await index.dispatch('test.event', 'arg1', 'arg2');
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
    const index = new HandlerIndex([createSlot('foo.bar', handler)], snapshot);

    const descriptors = index.list();
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toEqual({
      owner: 'test-plugin',
      name: 'foo.bar',
      source: '/handlers/foo/bar.ts',
      event: 'foo.bar',
    });
    expect((descriptors[0] as Record<string, unknown>).slot).toBeUndefined();
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
// Handler convention (separator = '.')
// ---------------------------------------------------------------------------

describe('typeScriptModules with separator', () => {
  it('joins nested local names with dot separator for handlers', async () => {
    const sources = await discoverHandlers('/workspace/plugin', {
      'handlers': [
        { name: 'message', kind: 'directory' },
      ],
      'handlers/message': [
        { name: 'receive.ts', kind: 'file' },
      ],
    });

    expect(sources).toEqual([
      { localName: 'message.receive', source: '/workspace/plugin/handlers/message/receive.ts' },
    ]);
  });

  it('handles deeply nested event paths', async () => {
    const sources = await discoverHandlers('/workspace/plugin', {
      'handlers': [
        { name: 'ai', kind: 'directory' },
      ],
      'handlers/ai': [
        { name: 'tool', kind: 'directory' },
      ],
      'handlers/ai/tool': [
        { name: 'call.ts', kind: 'file' },
        { name: 'result.ts', kind: 'file' },
      ],
    });

    expect(sources).toEqual([
      { localName: 'ai.tool.call', source: '/workspace/plugin/handlers/ai/tool/call.ts' },
      { localName: 'ai.tool.result', source: '/workspace/plugin/handlers/ai/tool/result.ts' },
    ]);
  });

  it('default separator is / (backwards compatible)', async () => {
    const convention = typeScriptModules({ id: 'test', directory: 'commands' });
    const host: DiscoveryHost = {
      async list(directory) {
        if (directory === '/pkg/commands') {
          return [{ name: 'sub', kind: 'directory' as const }];
        }
        if (directory === '/pkg/commands/sub') {
          return [{ name: 'cmd.ts', kind: 'file' as const }];
        }
        return [];
      },
      async loadModule<T>() { return {} as T; },
      async readText() { return ''; },
    };

    const sources: Array<{ localName: string }> = [];
    for await (const s of convention.discover({ owner: 'r' as never, packageRoot: '/pkg', host })) {
      sources.push({ localName: s.localName });
    }
    expect(sources).toEqual([{ localName: 'sub/cmd' }]);
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
    expect(handlerFeature.authoring.conventions[0].id).toBe('handlers-ts');
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
  const convention = typeScriptModules({
    id: 'handlers-ts',
    directory: 'handlers',
    separator: '.',
  });
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
