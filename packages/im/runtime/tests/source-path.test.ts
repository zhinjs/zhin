import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { normalizeSourcePath } from '../src/source-path.js';
import { InvalidationPlanner } from '../src/invalidation-planner.js';
import { SourceOwnershipIndex } from '../src/source-ownership.js';

it('matches aliased changes and removed sources to the scanned capability', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'zhin-source-path-'));
  try {
    const physical = join(await realpath(fixture), 'physical');
    const alias = join(fixture, 'alias');
    await mkdir(join(physical, 'commands/probe'), { recursive: true });
    await symlink(physical, alias, 'dir');
    const source = join(physical, 'commands/probe/index.ts');
    const notification = join(alias, 'commands/probe/index.ts');
    await writeFile(source, 'export default {};');
    const owner = rootPluginId();
    const feature = featureId('zhin.command');
    const slot = capabilityId(owner, feature, 'probe');
    const ownership = new SourceOwnershipIndex();
    ownership.addPackageRoot(alias, owner);
    ownership.add({ source, role: 'capability', owner, feature, capability: slot });
    const planner = new InvalidationPlanner(ownership);
    expect(normalizeSourcePath(notification)).toBe(source);
    expect(planner.plan([notification])).toMatchObject({ kind: 'generation', changed: [source], slots: [slot] });
    await rm(join(physical, 'commands'), { recursive: true });
    expect(normalizeSourcePath(notification)).toBe(source);
    expect(planner.plan([notification])).toMatchObject({ kind: 'generation', changed: [source], slots: [slot] });
    expect(ownership.ownersForPath(notification)).toEqual([owner]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

it('preserves lexical paths when no source or parent exists below the filesystem root', () => {
  expect(normalizeSourcePath('/zhin-missing-fixture/commands/probe/index.ts')).toBe('/zhin-missing-fixture/commands/probe/index.ts');
});
