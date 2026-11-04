import { describe, expect, it } from 'vitest';
import {
  CommandIndex,
  commandFeatureId,
  type CommandDefinition,
  type CommandParameterDefinition,
} from 'zhin.js/command';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js/plugin-runtime';
import checkin from '../commands/checkin/index.ts';
import forget from '../commands/forget/index.ts';
import keywordAdd from '../commands/keyword-add/[keyword]/index.ts';
import keywordList from '../commands/keyword-list/index.ts';
import keywordRemove from '../commands/keyword-remove/[keyword]/index.ts';
import mypoints from '../commands/mypoints/index.ts';
import mystats from '../commands/mystats/index.ts';
import rank from '../commands/rank/index.ts';
import statsCard from '../commands/stats-card/index.ts';
import statsRank from '../commands/stats-rank/index.ts';
import statsWeek from '../commands/stats-week/index.ts';
import stats from '../commands/stats/index.ts';
import teachList from '../commands/teach-list/[[page]]/index.ts';
import teachRegex from '../commands/teach-regex/index.ts';
import teach from '../commands/teach/index.ts';

type Entry = readonly [localName: string, definition: CommandDefinition, parameter?: CommandParameterDefinition];

/** Every bundled group-suite command, mirroring the file-system routes under commands/. */
const entries: readonly Entry[] = [
  ['checkin', checkin],
  ['forget', forget],
  ['keyword-add/$keyword', keywordAdd, { name: 'keyword', type: 'string' }],
  ['keyword-list', keywordList],
  ['keyword-remove/$keyword', keywordRemove, { name: 'keyword', type: 'string' }],
  ['mypoints', mypoints],
  ['mystats', mystats],
  ['rank', rank],
  ['stats-card', statsCard],
  ['stats-rank', statsRank],
  ['stats-week', statsWeek],
  ['stats', stats],
  ['teach-list/$page', teachList, { name: 'page', type: 'number', optional: true }],
  ['teach-regex', teachRegex],
  ['teach', teach],
];

/** Builds a real CommandIndex over the shipped definitions; execute is stubbed to report which file ran. */
function groupSuiteIndex(config: Record<string, unknown> = {}) {
  const owner = rootPluginId();
  const slots = entries.map(([localName, definition, parameter]) => createCapabilitySlot({
    owner,
    feature: commandFeatureId,
    localName,
    source: `/commands/${localName}/index.ts`,
    definition: {
      ...definition,
      ...(parameter ? { $parameter: parameter } : {}),
      execute: () => localName,
    } as CommandDefinition,
  }));
  const snapshot = {
    generation: 1,
    root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'group-suite', packageName: '@zhin.js/plugin-group-suite', packageRoot: '/test', children: [] }]]),
    config: new Map([[owner, config]]),
    resources: new Map([[owner, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  } satisfies RuntimeSnapshot;
  return new CommandIndex(slots, snapshot);
}

describe('group-suite checkin aliases', () => {
  it('declares the compatibility aliases on the shipped commands', () => {
    expect(checkin.alias).toEqual(['checkin do', '签到']);
    expect(mypoints.alias).toEqual(['checkin streak']);
    expect(rank.alias).toEqual(['checkin rank']);
  });

  it('builds the full command index without overlapping routes', () => {
    expect(() => groupSuiteIndex()).not.toThrow();
    expect(() => groupSuiteIndex({ commandNamespace: 'suite' })).not.toThrow();
  });

  it.each([
    ['checkin', 'checkin'],
    ['checkin do', 'checkin'],
    ['签到', 'checkin'],
    ['mypoints', 'mypoints'],
    ['checkin streak', 'mypoints'],
    ['rank', 'rank'],
    ['checkin rank', 'rank'],
  ])('routes %s to %s', async (input, expected) => {
    await expect(groupSuiteIndex().dispatch({ input })).resolves.toMatchObject({ status: 'executed', value: expected });
  });

  it('keeps aliases under the instance commandNamespace', async () => {
    const index = groupSuiteIndex({ commandNamespace: 'suite' });
    await expect(index.dispatch({ input: 'suite 签到' })).resolves.toMatchObject({ value: 'checkin' });
    await expect(index.dispatch({ input: 'suite checkin rank' })).resolves.toMatchObject({ value: 'rank' });
    await expect(index.dispatch({ input: 'suite checkin streak' })).resolves.toMatchObject({ value: 'mypoints' });
    expect(index.has('签到')).toBe(false);
  });

  it('lists aliases on the command descriptors', () => {
    const byName = new Map(groupSuiteIndex().list().map((command) => [command.name, command]));
    expect(byName.get('checkin')?.alias).toEqual(['checkin do', '签到']);
    expect(byName.get('mypoints')?.alias).toEqual(['checkin streak']);
    expect(byName.get('rank')?.alias).toEqual(['checkin rank']);
  });
});
