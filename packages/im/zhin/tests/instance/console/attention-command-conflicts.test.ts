/**
 * #1250 duplicate-command-route-crashes-instance: conflicts the Command index skipped are listed in
 * 「需要你处理」 (and through it in `zhin doctor`) with both plugin names, the command / alias and
 * what to do; the startup log warns once per conflict.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  SnapshotStore,
  childPluginId,
  createCapabilitySlot,
  rootPluginId,
  type CapabilitySlot,
  type PluginId,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand, type CommandDefinition } from '@zhin.js/command';
import { CONSOLE_ATTENTION_KIND_PERMISSIONS, grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import { createAttentionSources } from '../../../src/instance/console/attention-sources.js';
import { collectAttention } from '../../../src/instance/console/attention.js';
import type { ConsoleRpcComposition } from '../../../src/instance/console/rpc-composition.js';
import { CommandConflictLog } from '../../../src/instance/command-conflict-log.js';

const root = rootPluginId();
const groupSuite = childPluginId(root, 'group-suite');
const gameHub = childPluginId(root, 'game-hub');
const stores: SnapshotStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });

function command(owner: PluginId, localName: string, definition: Parameters<typeof defineCommand>[0]) {
  return createCapabilitySlot({
    owner, feature: commandFeatureId, localName,
    source: `/plugins/${String(owner).split('/').pop()}/commands/${localName}/index.ts`,
    definition: defineCommand(definition),
  }) as Readonly<CapabilitySlot<CommandDefinition>>;
}

function state(slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[]): SnapshotState {
  const child = (id: PluginId, key: string) => [id, { id, instanceKey: key, packageName: `@test/${key}`, packageRoot: `/plugins/${key}`, parent: root, children: [] }] as const;
  const base: Omit<SnapshotState, 'projections'> = {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [groupSuite, gameHub] }],
      child(groupSuite, 'group-suite'), child(gameHub, 'game-hub'),
    ]),
    config: new Map([[root, {}], [groupSuite, {}], [gameHub, {}]]),
    resources: new Map([[root, new Map()], [groupSuite, new Map()], [gameHub, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])),
  };
  const index = new CommandIndex(slots, { ...base, generation: 1, projections: new Map() });
  return { ...base, projections: new Map([[commandFeatureId, index]]) };
}

/** group-suite: `rank` (alias 排行) and `签到`; game-hub: `排行` and `签到` (alias `qd`). */
function conflictingSlots() {
  return [
    command(groupSuite, 'rank', { alias: ['排行'], execute: () => 'rank' }),
    command(groupSuite, '签到', { execute: () => 'sign' }),
    command(gameHub, '排行', { execute: () => 'board' }),
    command(gameHub, '签到', { alias: ['qd'], execute: () => 'sign 2' }),
  ];
}

function sourcesFor(slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[]) {
  const store = new SnapshotStore(state(slots));
  stores.push(store);
  return createAttentionSources({
    projectRoot: '/app', pluginLifecycleFile: '/app/plugin-lifecycle.json', snapshots: store,
    configuration: { readSource: async () => ({}) },
  } as unknown as ConsoleRpcComposition);
}

describe('command.conflict attention items (#1250)', () => {
  it('lists the skipped alias and the skipped command with both plugins and advice', async () => {
    const list = await collectAttention(sourcesFor(conflictingSlots()), { allows: () => true });
    const items = list.items.filter(item => item.kind === 'command.conflict');
    expect(items.map(item => [item.id, item.severity, item.source, item.action.path])).toEqual(expect.arrayContaining([
      ['command.conflict:commandRoute=%E6%8E%92%E8%A1%8C&plugin=group-suite', 'warning', 'commands', '/plugins/group-suite'],
      ['command.conflict:commandRoute=%E7%AD%BE%E5%88%B0&plugin=game-hub', 'warning', 'commands', '/plugins/game-hub'],
    ]));
    expect(items).toHaveLength(2);

    const alias = items.find(item => item.subject?.plugin === 'group-suite')!;
    expect(alias.title).toBe('插件 group-suite 的命令「rank」的别名「排行」已被占用，已跳过该别名');
    expect(alias.detail).toContain('「排行」已由插件 game-hub 的命令「排行」使用，只跳过了这个别名，命令本身照常可用。');
    expect(alias.detail).toContain('group-suite 的 disabledCommands: [rank]');
    expect(alias.detail).toContain('game-hub 的 disabledCommands: [排行]');
    expect(alias.reason).toEqual({ category: 'config', code: 'command-alias-conflict' });

    const primary = items.find(item => item.subject?.plugin === 'game-hub')!;
    expect(primary.title).toBe('插件 game-hub 的命令「签到」与插件 group-suite 重名，没有注册');
    expect(primary.detail).toContain('「签到」已由插件 group-suite 的命令「签到」使用，先注册的保留');
    expect(primary.detail).toContain('建议让其中一个插件改名');
    expect(primary.reason).toEqual({ category: 'config', code: 'command-command-conflict' });
  });

  it('reads nothing without feature.view and reports nothing without conflicts', async () => {
    expect(CONSOLE_ATTENTION_KIND_PERMISSIONS['command.conflict']).toBe('feature.view');
    const viewer = (grants: ConsoleGrant[]) => (permission: string, target?: ConsoleScopeTarget) => grantsAllow(grants, permission, target);
    const hidden = await collectAttention(sourcesFor(conflictingSlots()), {
      allows: viewer([{ role: 'viewer', scope: { kind: 'global' }, permissions: ['status.view'] }]),
    });
    expect(hidden.items.some(item => item.kind === 'command.conflict')).toBe(false);

    const clean = await collectAttention(sourcesFor([command(groupSuite, 'rank', { execute: () => 'rank' })]), { allows: () => true });
    expect(clean.items.some(item => item.kind === 'command.conflict')).toBe(false);
    expect(clean.unavailable ?? []).not.toContain('commands');
  });

  it('logs each conflict once and again only after it was resolved and came back', () => {
    const warned: Record<string, unknown>[] = [];
    const log = new CommandConflictLog(fields => warned.push(fields));
    const conflicted = state(conflictingSlots());
    log.report({ ...conflicted, generation: 1 });
    expect(warned).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'command_route_conflict', route: '排行', skipped: 'group-suite:rank alias=排行', kept: 'game-hub:排行', result: 'alias_skipped' }),
      expect.objectContaining({ op: 'command_route_conflict', route: '签到', skipped: 'game-hub:签到', kept: 'group-suite:签到', result: 'command_not_registered' }),
    ]));
    expect(warned).toHaveLength(2);
    // A hot reload that keeps the same conflicts does not repeat them.
    log.report({ ...conflicted, generation: 2 });
    expect(warned).toHaveLength(2);
    log.report({ ...state([command(groupSuite, 'rank', { execute: () => 'rank' })]), generation: 3 });
    log.report({ ...conflicted, generation: 4 });
    expect(warned).toHaveLength(4);
    expect(String(warned.find(fields => fields.route === '排行')!.hint)).toContain('group-suite.disabledCommands: [rank]');
  });
});
