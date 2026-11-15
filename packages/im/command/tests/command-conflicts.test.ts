/**
 * #1250 duplicate-command-route-crashes-instance: two plugins claiming the same command route or
 * alias must not fail the Command projection (which used to stop the whole instance). The earlier
 * registration keeps the route, the later one is skipped and reported by `conflicts()`.
 */
import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  rootPluginId,
  type CapabilitySlot,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand, type CommandDefinition } from '../src/index.js';

const root = rootPluginId();
const groupSuite = childPluginId(root, 'group-suite');
const gameHub = childPluginId(root, 'game-hub');

function command(owner: PluginId, localName: string, definition: Parameters<typeof defineCommand>[0]) {
  return createCapabilitySlot({
    owner,
    feature: commandFeatureId,
    localName,
    source: `/plugins/${String(owner).split('/').pop()}/commands/${localName}/index.ts`,
    definition: defineCommand(definition),
  }) as Readonly<CapabilitySlot<CommandDefinition>>;
}

/** Root with two child plugins declared in this order; `slots` gives the capability map order. */
function snapshot(slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[], generation = 1): RuntimeSnapshot {
  const child = (id: PluginId, key: string) => [id, {
    id, instanceKey: key, packageName: `@test/${key}`, packageRoot: `/plugins/${key}`, parent: root, children: [],
  }] as const;
  return {
    generation,
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [groupSuite, gameHub] }],
      child(groupSuite, 'group-suite'),
      child(gameHub, 'game-hub'),
    ]),
    config: new Map([[root, {}], [groupSuite, {}], [gameHub, {}]]),
    resources: new Map([[root, new Map()], [groupSuite, new Map()], [gameHub, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])),
    projections: new Map(),
  };
}

describe('Command route conflicts (#1250)', () => {
  it('skips only a colliding alias: both commands stay registered', async () => {
    const rank = command(groupSuite, 'rank', { alias: ['排行', 'top'], execute: () => 'group-suite rank' });
    const leaderboard = command(gameHub, '排行', { execute: () => 'game-hub 排行' });
    const index = new CommandIndex([rank, leaderboard], snapshot([rank, leaderboard]));

    expect(index.list().map(entry => [entry.name, entry.alias])).toEqual(expect.arrayContaining([
      ['rank', ['top']],
      ['排行', undefined],
    ]));
    // The primary command name wins over another plugin's alias, whatever the plugin order.
    await expect(index.dispatch({ input: '排行' })).resolves.toMatchObject({ status: 'executed', value: 'game-hub 排行' });
    await expect(index.dispatch({ input: 'top' })).resolves.toMatchObject({ status: 'executed', value: 'group-suite rank' });
    await expect(index.dispatch({ input: 'rank' })).resolves.toMatchObject({ status: 'executed', value: 'group-suite rank' });
    expect(index.conflicts()).toEqual([{
      route: '排行',
      skipped: expect.objectContaining({ plugin: 'group-suite', packageName: '@test/group-suite', command: 'rank', localPath: 'rank', kind: 'alias', entry: '排行' }),
      kept: expect.objectContaining({ plugin: 'game-hub', command: '排行', localPath: '排行', kind: 'command' }),
    }]);
  });

  it('keeps the earlier plugin for a colliding alias of two commands', async () => {
    const first = command(groupSuite, 'rank', { alias: ['排行'], execute: () => 'first' });
    const second = command(gameHub, 'board', { alias: ['排行'], execute: () => 'second' });
    const index = new CommandIndex([second, first], snapshot([second, first]));

    await expect(index.dispatch({ input: '排行' })).resolves.toMatchObject({ value: 'first' });
    await expect(index.dispatch({ input: 'board' })).resolves.toMatchObject({ value: 'second' });
    expect(index.conflicts()).toEqual([expect.objectContaining({
      route: '排行',
      skipped: expect.objectContaining({ plugin: 'game-hub', command: 'board', kind: 'alias', entry: '排行' }),
      kept: expect.objectContaining({ plugin: 'group-suite', command: 'rank', kind: 'alias', entry: '排行' }),
    })]);
  });

  it('skips the later command when the primary routes collide', async () => {
    const first = command(groupSuite, '排行', { alias: ['rank'], shortcut: { 今日排行: {} }, execute: () => 'first' });
    const second = command(gameHub, '排行', { alias: ['board'], execute: () => 'second' });
    // Capability map order puts game-hub first; plugin tree order decides.
    const index = new CommandIndex([second, first], snapshot([second, first]));

    expect(index.list().map(entry => entry.owner)).toEqual([groupSuite]);
    await expect(index.dispatch({ input: '排行' })).resolves.toMatchObject({ value: 'first' });
    await expect(index.dispatch({ input: 'rank' })).resolves.toMatchObject({ value: 'first' });
    await expect(index.dispatch({ input: '今日排行' })).resolves.toMatchObject({ value: 'first' });
    // The skipped command's own aliases are not routed either.
    await expect(index.dispatch({ input: 'board' })).resolves.toMatchObject({ status: 'unmatched' });
    expect(index.conflicts()).toEqual([expect.objectContaining({
      route: '排行',
      skipped: expect.objectContaining({ plugin: 'game-hub', command: '排行', kind: 'command' }),
      kept: expect.objectContaining({ plugin: 'group-suite', command: '排行', kind: 'command' }),
    })]);
  });

  it('reports nothing when a plugin generation replaces its own commands (hot reload)', async () => {
    const rank = command(groupSuite, 'rank', { alias: ['排行'], execute: () => 'v1' });
    const other = command(gameHub, 'board', { execute: () => 'board' });
    const before = new CommandIndex([rank, other], snapshot([rank, other]));
    expect(before.conflicts()).toEqual([]);

    // The reloaded slot keeps its capability id and replaces the old one in the next generation.
    const reloaded = command(groupSuite, 'rank', { alias: ['排行', 'top'], execute: () => 'v2' });
    expect(reloaded.id).toBe(rank.id);
    const capabilities = new Map([[rank.id, rank], [other.id, other]] as const);
    capabilities.delete(rank.id);
    capabilities.set(reloaded.id, reloaded);
    const after = new CommandIndex([...capabilities.values()], snapshot([...capabilities.values()], 2));
    expect(after.conflicts()).toEqual([]);
    await expect(after.dispatch({ input: '排行' })).resolves.toMatchObject({ value: 'v2' });
  });

  it('keeps the same winner after the winning plugin reloads (its slots move in the capability map)', async () => {
    const first = command(groupSuite, '排行', { execute: () => 'first' });
    const second = command(gameHub, '排行', { execute: () => 'second' });
    const initial = new CommandIndex([first, second], snapshot([first, second]));
    const reloadedFirst = command(groupSuite, '排行', { execute: () => 'first v2' });
    // Slot HMR deletes and re-adds the reloaded slot: it is now last in the map.
    const reloaded = new CommandIndex([second, reloadedFirst], snapshot([second, reloadedFirst], 2));

    await expect(initial.dispatch({ input: '排行' })).resolves.toMatchObject({ value: 'first' });
    await expect(reloaded.dispatch({ input: '排行' })).resolves.toMatchObject({ value: 'first v2' });
    expect(reloaded.conflicts()).toEqual([expect.objectContaining({
      skipped: expect.objectContaining({ plugin: 'game-hub' }),
      kept: expect.objectContaining({ plugin: 'group-suite' }),
    })]);
  });
});
