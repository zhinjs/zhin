import { describe, expect, it } from 'vitest';
import { changedConfigurationPaths } from '../src/configuration-paths.js';

describe('changedConfigurationPaths', () => {
  it.each([[undefined, {}], [{}, undefined]])('preserves an absent/empty block transition', (before, after) => {
    expect(changedConfigurationPaths(before, after, ['http'])).toEqual([['http']]);
    expect(changedConfigurationPaths({ nested: before }, { nested: after }, ['plugin']))
      .toEqual([['plugin', 'nested']]);
  });
});
