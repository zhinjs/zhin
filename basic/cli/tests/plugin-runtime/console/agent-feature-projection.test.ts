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
import { jsx } from '@zhin.js/core/jsx';
import {
  PromptSectionIndex,
  defineAgentPromptSection,
  promptSectionFeatureId,
} from '@zhin.js/prompt-section';
import {
  listGenerationPromptSections,
  listGenerationTools,
  renderGenerationComponent,
} from '../../../src/plugin-runtime/console/agent-feature-projection.js';

describe('Agent generation feature projections', () => {
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

  it('renders local JSX with the requested owner, props, signal and exact operation generation', async () => {
    const signal = new AbortController().signal;
    const render = vi.fn(({ text }: { text: string }, context: ComponentContext) => {
      expect(context.owner.id).toBe(child);
      expect(context.requester.id).toBe(child);
      expect(context.signal).toBe(signal);
      return jsx('b', { children: `${text}:${context.generation}:${context.use(greeting)}` });
    });
    const parent = vi.fn(() => 'parent');
    const view = snapshot([slot(root, 'card', parent), slot(child, 'card', render)], 12, 'current');

    expect(await preview(view, 'card', signal)).toEqual({ type: 'html', data: { html: '<b>actual:12:current</b>' } });
    expect(render).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });

  it('evaluates async JSX once per preview and recursively flattens mixed content and component calls', async () => {
    const signal = new AbortController().signal;
    const asyncJsx = vi.fn(async () => jsx('i', { children: 'ready' }));
    const node = jsx(asyncJsx, {});
    const nested = vi.fn(({ text }: { text: string }, context: ComponentContext) => {
      expect(context.owner.id).toBe(root);
      expect(context.requester.id).toBe(child);
      expect(context.signal).toBe(signal);
      return jsx('b', { children: text });
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
      return jsx('p', { children: `${context.generation}:${context.use(greeting)}` });
    };
    const slots = [slot(child, 'card', render)];
    const old = preview(snapshot(slots, 1, 'old'), 'card');
    const current = preview(snapshot(slots, 2, 'current'), 'card');
    release();
    expect(await old).toEqual({ type: 'html', data: { html: '<p>1:old</p>' } });
    expect(await current).toEqual({ type: 'html', data: { html: '<p>2:current</p>' } });
  });

  it('rejects aborted previews before invoking registered components', async () => {
    const render = vi.fn(() => jsx('b', { children: 'never' }));
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
      return jsx('b', { children: 'discarded' });
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
