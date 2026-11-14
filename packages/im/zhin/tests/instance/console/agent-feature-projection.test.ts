import { describe, expect, it, vi } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  createSnapshotView,
  createToken,
  featureId,
  rootPluginId,
  type CapabilitySlot,
  type PluginId,
  type SnapshotState,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { ComponentIndex, componentFeatureId, defineComponent, type ComponentContext, type ComponentDefinition } from '@zhin.js/component';
import { component, type SendContent } from '@zhin.js/core/runtime';
import { Html, jsx } from '@zhin.js/core/jsx';
import {
  PromptSectionIndex,
  defineAgentPromptSection,
  promptSectionFeatureId,
} from '@zhin.js/prompt-section';
import { commandFeatureId } from '@zhin.js/command';
import { middlewareFeatureId } from '@zhin.js/middleware';
import {
  introspectionOwner,
  listGenerationCommands,
  listGenerationMiddlewares,
  listGenerationPromptSections,
  listGenerationTools,
  renderGenerationComponent,
} from '../../../src/instance/console/agent-feature-projection.js';

describe('Agent generation feature projections', () => {
  it('names the owning plugin instance and package on every capability row (#1250)', () => {
    const root = rootPluginId();
    const reminder = childPluginId(root, 'reminder');
    const node = (id: PluginId, instanceKey: string, packageName: string) => [id, {
      id, instanceKey, packageName, packageRoot: `/project/node_modules/${packageName}`, children: [],
    }] as const;
    const gone = childPluginId(root, 'gone');
    const snapshot = {
      root,
      tree: new Map([node(root, 'root', 'my-bot'), node(reminder, 'reminder', '@zhin.js/plugin-reminder')]),
      projections: new Map<unknown, unknown>([
        [commandFeatureId, { $projection: 'zhin.command-index/1', list: () => [
          { owner: reminder, name: 'remind', source: '/project/node_modules/@zhin.js/plugin-reminder/commands/remind/index.ts', parameters: [] },
          { owner: gone, name: 'orphan', source: '/project/commands/orphan/index.ts', parameters: [] },
        ] }],
        [middlewareFeatureId, { $projection: 'zhin.middleware-index/1', list: () => [
          { owner: root, name: 'log', phase: 'inbound', target: 'message', order: 0, source: '/project/middlewares/log/index.ts' },
        ] }],
        [featureId('zhin.agent-tool'), { list: () => [{ owner: reminder, name: 'remind_list', source: '/project/tools/x.ts' }] }],
      ]),
    } as unknown as RuntimeSnapshot;

    const [remind, orphan] = listGenerationCommands(snapshot, '/project');
    expect(remind).toMatchObject({
      pattern: 'remind',
      owner: String(reminder),
      pluginInstance: 'reminder',
      pluginPackage: '@zhin.js/plugin-reminder',
      // The historical `plugin` field stays the source path.
      plugin: './node_modules/@zhin.js/plugin-reminder/commands/remind/index.ts',
    });
    // An owner no longer in the tree keeps only its id; the plugin fields are optional.
    expect(orphan).toMatchObject({ owner: String(gone) });
    expect(orphan).not.toHaveProperty('pluginInstance');
    expect(orphan).not.toHaveProperty('pluginPackage');
    expect(listGenerationMiddlewares(snapshot, '/project')[0]).toMatchObject({ owner: String(root), pluginInstance: 'root', pluginPackage: 'my-bot' });
    expect(listGenerationTools(snapshot, '/project')[0]).toMatchObject({ pluginInstance: 'reminder', pluginPackage: '@zhin.js/plugin-reminder' });
    expect(introspectionOwner(undefined, undefined)).toEqual({});
  });

  it('projects Prompt Section governance metadata without prompt content', () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: promptSectionFeatureId,
      localName: 'project-rules',
      source: '/project/prompt-sections/project-rules/index.ts',
      definition: defineAgentPromptSection({
        title: 'Project rules',
        content: 'Keep internal policy private.',
        retention: 'required',
      }),
    });
    const base = {
      generation: 12,
      root,
      tree: new Map(),
      config: new Map(),
      resources: new Map(),
      capabilities: new Map([[slot.id, slot]]),
      projections: new Map(),
    } as unknown as RuntimeSnapshot;
    const snapshot = {
      ...base,
      projections: new Map([[promptSectionFeatureId, new PromptSectionIndex([slot], base)]]),
    } as unknown as RuntimeSnapshot;

    expect(listGenerationPromptSections(snapshot, '/project')).toEqual([expect.objectContaining({
      name: 'project-rules',
      title: 'Project rules',
      retention: 'required',
      source: './prompt-sections/project-rules/index.ts',
      generation: 12,
      contentChars: 29,
    })]);
    expect(listGenerationPromptSections(snapshot, '/project')[0]).not.toHaveProperty('content');
  });

  it('lists visible tools and keeps the last projection for a duplicate name', () => {
    const snapshot = {
      projections: new Map([
        [featureId('zhin.agent-tool'), {
          list: () => [
            { name: 'search', source: '/project/tools/old.ts', description: 'old' },
            { name: 'hidden', source: '/project/tools/hidden.ts', hidden: true },
          ],
        }],
        [featureId('zhin.extra-tool'), {
          list: () => [{ name: 'search', source: '/project/tools/search.ts', description: 'current' }],
        }],
      ]),
    } as unknown as RuntimeSnapshot;

    expect(listGenerationTools(snapshot, '/project')).toEqual([{
      name: 'search',
      source: './tools/search.ts',
      description: 'current',
    }]);
  });
});

describe('Console generation Component previews', () => {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  const greeting = createToken<string>('test.console-preview-greeting');

  const slot = (owner: PluginId, name: string, render: (props: { text: string }, context: ComponentContext) => SendContent | Promise<SendContent>) =>
    createCapabilitySlot({
      owner, feature: componentFeatureId, localName: name,
      source: `/components/${name}/index.tsx`,
      definition: defineComponent({ render }),
    });

  const snapshot = (slots: readonly Readonly<CapabilitySlot<ComponentDefinition>>[], generation: number, resource: string): RuntimeSnapshot => {
    const state: SnapshotState = {
      root,
      tree: new Map([
        [root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [child] }],
        [child, { id: child, instanceKey: 'child', packageName: '@test/child', packageRoot: '/project/child', parent: root, children: [] }],
      ]),
      config: new Map([[root, {}], [child, {}]]),
      resources: new Map([[root, new Map([[greeting.id, resource]])], [child, new Map([[greeting.id, resource]])]]),
      capabilities: new Map(slots.map(value => [value.id, value])),
      projections: new Map(),
    };
    // Deliberately reuse a projection created in a previous generation. The
    // operation snapshot, rather than its construction view, must supply context.
    const stale = createSnapshotView(generation - 1, { ...state, resources: new Map([[root, new Map([[greeting.id, 'stale']])], [child, new Map([[greeting.id, 'stale']])]]) });
    return createSnapshotView(generation, { ...state, projections: new Map([[componentFeatureId, new ComponentIndex(slots, stale)]]) });
  };

  const preview = (view: RuntimeSnapshot, name: string, signal: AbortSignal = new AbortController().signal) =>
    renderGenerationComponent(view, { requester: String(child), name, props: { text: 'actual' }, signal });

  it('previews message JSX as native segments without converting it to HTML', async () => {
    const view = snapshot([slot(child, 'message', () => jsx('image', { src: 'https://example.com/image.png' }))], 12, 'current');
    expect(await preview(view, 'message')).toEqual([
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/image.png' } } },
    ]);
  });

  it('renders local JSX with the requested owner, props, signal and exact operation generation', async () => {
    const signal = new AbortController().signal;
    const render = vi.fn(({ text }: { text: string }, context: ComponentContext) => {
      expect(context.owner.id).toBe(child);
      expect(context.requester.id).toBe(child);
      expect(context.signal).toBe(signal);
      return jsx(Html, { children: jsx('b', { children: `${text}:${context.generation}:${context.use(greeting)}` }) });
    });
    const parent = vi.fn(() => 'parent');
    const view = snapshot([slot(root, 'card', parent), slot(child, 'card', render)], 12, 'current');

    expect(await preview(view, 'card', signal)).toEqual([{ type: 'html', data: { html: '<b>actual:12:current</b>' } }]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });

  it('evaluates async JSX once per preview and recursively flattens mixed content and component calls', async () => {
    const signal = new AbortController().signal;
    const asyncJsx = vi.fn(async () => jsx(Html, { children: jsx('i', { children: 'ready' }) }));
    const node = jsx(asyncJsx, {});
    const nested = vi.fn(({ text }: { text: string }, context: ComponentContext) => {
      expect(context.owner.id).toBe(root);
      expect(context.requester.id).toBe(child);
      expect(context.signal).toBe(signal);
      return jsx(Html, { children: jsx('b', { children: text }) });
    });
    const view = snapshot([
      slot(child, 'card', async () => ['before', [node, node, component('nested', { text: 'forwarded' })], 'after']),
      slot(root, 'nested', nested),
    ], 2, 'current');
    const expected = [
      'before', { type: 'html', data: { html: '<i>ready</i>' } },
      { type: 'html', data: { html: '<i>ready</i>' } },
      { type: 'html', data: { html: '<b>forwarded</b>' } }, 'after',
    ];
    const output = await preview(view, 'card', signal);
    expect(output).toEqual(expected);
    expect(asyncJsx).toHaveBeenCalledTimes(1);
    expect(nested).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.stringify(output))).toEqual(expected);
    expect(await preview(view, 'card', signal)).toEqual(expected);
    expect(asyncJsx).toHaveBeenCalledTimes(2);
  });

  it('keeps concurrent previews on their own snapshot while async rendering settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const render = async (_props: { text: string }, context: ComponentContext) => {
      await gate;
      return jsx(Html, { children: jsx('p', { children: `${context.generation}:${context.use(greeting)}` }) });
    };
    const slots = [slot(child, 'card', render)];
    const old = preview(snapshot(slots, 1, 'old'), 'card');
    const current = preview(snapshot(slots, 2, 'current'), 'card');
    release();
    expect(await old).toEqual([{ type: 'html', data: { html: '<p>1:old</p>' } }]);
    expect(await current).toEqual([{ type: 'html', data: { html: '<p>2:current</p>' } }]);
  });

  it('rejects aborted previews before invoking registered components', async () => {
    const render = vi.fn(() => jsx(Html, { children: jsx('b', { children: 'never' }) }));
    const controller = new AbortController();
    controller.abort(new Error('preview cancelled'));
    await expect(preview(snapshot([slot(child, 'card', render)], 1, 'current'), 'card', controller.signal)).rejects.toThrow('preview cancelled');
    expect(render).not.toHaveBeenCalled();
  });

  it('does not return HTML when cancellation occurs inside an async JSX function', async () => {
    const controller = new AbortController();
    const cancelled = new Error('preview cancelled during JSX');
    const render = vi.fn(async () => {
      controller.abort(cancelled);
      return jsx(Html, { children: jsx('b', { children: 'discarded' }) });
    });
    const view = snapshot([slot(child, 'card', () => jsx(render, {}))], 1, 'current');
    await expect(preview(view, 'card', controller.signal)).rejects.toBe(cancelled);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('bounds recursive registered component calls instead of returning unresolved calls', async () => {
    const view = snapshot([slot(child, 'loop', () => component('loop', {}))], 1, 'current');
    await expect(preview(view, 'loop')).rejects.toThrow('Component render depth exceeded');
  });
});
