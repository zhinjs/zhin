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
  parseComponentDefinition,
} from '../src/index.js';

describe('Component Feature', () => {
  it('brands pure render definitions without a module registry', () => {
    const component = defineComponent({ render: (props: { text: string }) => props.text });
    expect(parseComponentDefinition(component)).toBe(component);
    expect(() => parseComponentDefinition({ render() {} })).toThrow('defineComponent');
  });

  it('discovers nested TS and TSX component modules', async () => {
    const definition = defineComponent({ render: () => 'ok' });
    const host = new MemoryDiscoveryHost({
      '/project/components': [{ name: 'forms', kind: 'directory' }],
      '/project/components/forms': [
        { name: 'input.tsx', kind: 'file' },
        { name: 'label.ts', kind: 'file' },
      ],
    }, new Map([
      ['/project/components/forms/input.tsx', { default: definition }],
      ['/project/components/forms/label.ts', { default: definition }],
    ]));

    const slots = await new FeatureDiscovery(host).discover(componentFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['forms/input', 'forms/label']);
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

    await expect(index.render(child, 'badge', {})).resolves.toBe(
      'root/child:root/child:child',
    );
    await expect(index.render(child, 'shared/text', {})).resolves.toBe('root:shared');
    await expect(index.render(root, 'badge', {})).resolves.toBe('root:hello:root');
    expect(index.has(child, 'shared/text')).toBe(true);
    await expect(index.render(child, 'missing', {})).rejects.toThrow('Unknown Component');
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
    source: `/components/${localName}.tsx`,
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
