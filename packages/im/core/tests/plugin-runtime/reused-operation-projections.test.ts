import { createCapabilitySlot, createToken, featureId, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { ComponentIndex, componentFeatureId, defineComponent } from '@zhin.js/component';

it.each(['command', 'command-dispatch', 'component'] as const)('reused %s binds current context and drains old context independently', async (kind) => {
  const owner = rootPluginId();
  const token = createToken<string>('test.operation-resource');
  const probe = featureId('test.operation-probe');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inspect = async (context: { generation: number; project<T>(id: typeof probe): T; use<T>(key: typeof token): T }, delayed: boolean) => {
    if (delayed) await gate;
    return [context.generation, context.project(probe), context.use(token)];
  };
  const command = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'probe', source: '/commands/probe/index.ts', definition: defineCommand({ execute: (context) => inspect(context, context.args[0] === 'wait') }) });
  const component = createCapabilitySlot({ owner, feature: componentFeatureId, localName: 'probe', source: '/components/probe/index.ts', definition: defineComponent({ render: (props: { delayed: boolean }, context) => inspect(context, props.delayed) }) });
  const old: RuntimeSnapshot = {
    generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map([[token.id, 'old-resource']])]]),
    capabilities: new Map(), projections: new Map([[probe, 'old-projection']]),
  };
  const current = { ...old, generation: 2, resources: new Map([[owner, new Map([[token.id, 'current-resource']])]]), projections: new Map([[probe, 'current-projection']]) };
  const index = kind !== 'component' ? new CommandIndex([command], old) : new ComponentIndex([component], old);
  const run = (snapshot: RuntimeSnapshot, delayed: boolean) => index instanceof CommandIndex
    ? kind === 'command-dispatch'
      ? index.dispatch(delayed ? 'probe wait' : 'probe', undefined, undefined, '', snapshot).then((result) => result.value)
      : index.execute('probe', delayed ? ['wait'] : [], snapshot)
    : index.render(owner, 'probe', { delayed }, { snapshot });
  const draining = run(old, true);
  expect(await run(current, false)).toEqual([2, 'current-projection', 'current-resource']);
  release();
  expect(await draining).toEqual([1, 'old-projection', 'old-resource']);
});
