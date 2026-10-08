import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  createToken,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';
import componentFeature, {
  ComponentIndex,
  componentFeatureId,
  defineComponent,
  isComponentIndex,
  parseComponentDefinition,
} from '../src/index.js';

describe('Component Feature', () => {
  it('keeps author supplied preview parameters without using them as render defaults', () => {
    const definition = defineComponent<{ text: string }, string>({
      previewProps: { text: 'example' }, render: ({ text }) => text,
    });
    expect(parseComponentDefinition(definition).previewProps).toEqual({ text: 'example' });
    expect(definition.render({ text: 'actual' }, {} as never)).toBe('actual');
  });

  it('brands pure render definitions without a module registry', () => {
    const component = defineComponent({ render: (props: { text: string }) => props.text });
    expect(parseComponentDefinition(component)).toBe(component);
    expect(() => parseComponentDefinition({ render() {} })).toThrow('defineComponent');
  });

  it('publishes only author opted-in preview parameters in component descriptors', () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const greeting = createToken<string>('test.preview');
    const slot = createCapabilitySlot({
      owner: root, feature: componentFeatureId, localName: 'example', source: '/components/example/index.ts',
      definition: defineComponent({ previewProps: { text: 'sample' }, render: ({ text }: { text: string }) => text }),
    });
    const plain = componentSlot(root, 'plain', () => 'ok');
    const slots = [slot, plain];
    const index = new ComponentIndex(slots, snapshot(root, child, slots, greeting.id));
    expect(index.list().find(item => item.name === 'example')?.previewProps).toEqual({ text: 'sample' });
    expect(index.list().find(item => item.name === 'plain')).not.toHaveProperty('previewProps');
  });

  it('discovers named TS and TSX component modules', async () => {
    const definition = defineComponent({ render: () => 'ok' });
    const host = new MemoryDiscoveryHost({
      '/project/components': [
        { name: 'input', kind: 'directory' },
        { name: 'label', kind: 'directory' },
      ],
      '/project/components/input': [{ name: 'index.tsx', kind: 'file' }],
      '/project/components/label': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([
      ['/project/components/input/index.tsx', { default: definition }],
      ['/project/components/label/index.ts', { default: definition }],
    ]));

    const slots = await new FeatureDiscovery(host).discover(componentFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['input', 'label']);
  });

  it('resolves exact owner overrides before inherited ancestor Components', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const greeting = createToken<string>('test.greeting');
    const rootBadge = componentSlot(root, 'badge', ({ requester, use }) =>
      `${requester.id}:${use(greeting)}:root`);
    const childBadge = componentSlot(child, 'badge', ({ owner, requester }) =>
      `${owner.id}:${requester.id}:child`);
    const shared = componentSlot(root, 'shared/text', ({ owner }) => `${owner.id}:shared`);
    const slots = [rootBadge, childBadge, shared];
    const value = snapshot(root, child, slots, greeting.id);
    const index = new ComponentIndex(slots, value);
    expect(isComponentIndex(index)).toBe(true);
    expect(isComponentIndex({ $projection: 'zhin.component-index/1' })).toBe(true);

    await expect(index.render(child, 'badge', {})).resolves.toBe(
      'root/child:root/child:child',
    );
    await expect(index.render(child, 'shared/text', {})).resolves.toBe('root:shared');
    await expect(index.render(root, 'badge', {})).resolves.toBe('root:hello:root');
    expect(index.has(child, 'shared/text')).toBe(true);
    await expect(index.render(child, 'missing', {})).rejects.toThrow('Unknown Component');
  });
  it('keeps cancellation local to its render and rejects late results', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const controller = new AbortController();
    const slot = componentSlot(root, 'pending', async ({ signal }) => {
      calls++;
      if (signal === controller.signal) await gate;
      return 'rendered';
    });
    const index = new ComponentIndex([slot], snapshot(root, child, [slot], createToken<string>('cancel-test').id));
    const pending = index.render(child, 'pending', {}, { signal: controller.signal });
    const reason = new Error('operation cancelled');
    controller.abort(reason);
    await expect(index.render(child, 'pending', {})).resolves.toBe('rendered');
    const rejected = expect(pending).rejects.toBe(reason);
    release();
    await rejected;
    await expect(index.render(child, 'pending', {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(calls).toBe(2);
  });

});

function componentSlot(
  owner: ReturnType<typeof rootPluginId>,
  localName: string,
  render: (context: Parameters<ReturnType<typeof defineComponent>['render']>[1]) => unknown,
) {
  return createCapabilitySlot({
    owner,
    feature: componentFeatureId,
    localName,
    source: `/components/${localName}/index.tsx`,
    definition: defineComponent({ render: (_props, context) => render(context) }),
  });
}

function snapshot(
  root: ReturnType<typeof rootPluginId>,
  child: ReturnType<typeof childPluginId>,
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
  greetingId: ReturnType<typeof createToken>['id'],
): RuntimeSnapshot {
  return {
    generation: 1,
    root,
    tree: new Map([
      [root, {
        id: root,
        instanceKey: 'root',
        packageName: '@test/root',
        packageRoot: '/project',
        children: [child],
      }],
      [child, {
        id: child,
        instanceKey: 'child',
        packageName: '@test/child',
        packageRoot: '/project/plugins/child',
        parent: root,
        children: [],
      }],
    ]),
    config: new Map([[root, {}], [child, {}]]),
    resources: new Map([
      [root, new Map([[greetingId, 'hello']])],
      [child, new Map([[greetingId, 'hello']])],
    ]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

class MemoryDiscoveryHost implements DiscoveryHost {
  constructor(
    private readonly directories: Readonly<Record<string, readonly DirectoryEntry[]>>,
    private readonly modules: ReadonlyMap<string, unknown>,
  ) {}
  async list(directory: string): Promise<readonly DirectoryEntry[]> {
    return this.directories[directory] ?? [];
  }
  async loadModule<T>(source: string): Promise<T> {
    const module = this.modules.get(source);
    if (!module) throw new Error(`Missing module: ${source}`);
    return module as T;
  }
  async readText(): Promise<string> { throw new Error('Not implemented'); }
}
