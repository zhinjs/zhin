import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  rootPluginId,
  scheduleHostToken,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { FeatureDiscovery, type DiscoveryHost } from '@zhin.js/feature-kit';
import scheduleFeature, {
  defineSchedule,
  ScheduleIndex,
  scheduleFeatureId,
} from '../src/index.js';

describe('Schedule Feature', () => {
  it('discovers schedules/<name>/index.ts and ignores sibling helpers', async () => {
    const definition = defineSchedule({ cron: '0 0 9 * * *', execute() {} });
    const host: DiscoveryHost = {
      async list(directory) {
        if (directory === '/project/schedules') {
          return [
            { name: 'daily-report', kind: 'directory' },
            { name: 'helper.ts', kind: 'file' },
          ];
        }
        if (directory === '/project/schedules/daily-report') {
          return [
            { name: 'index.ts', kind: 'file' },
            { name: 'format.ts', kind: 'file' },
          ];
        }
        return [];
      },
      async loadModule<T>(): Promise<T> { return { default: definition } as T; },
      async readText(): Promise<string> { throw new Error('unused'); },
    };
    const slots = await new FeatureDiscovery(host).discover(scheduleFeature, [{
      owner: rootPluginId(),
      packageRoot: '/project',
    }]);

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      localName: 'daily-report',
      source: '/project/schedules/daily-report/index.ts',
    });
  });

  it('registers jobs through the owner-scoped Schedule Host and disposes them', () => {
    const owner = rootPluginId();
    const events: string[] = [];
    const definition = defineSchedule({ cron: '0 * * * * *', execute() {} });
    const slot = createCapabilitySlot({
      owner,
      feature: scheduleFeatureId,
      localName: 'heartbeat',
      source: '/project/schedules/heartbeat/index.ts',
      definition,
    });
    const resources = new Map<string, unknown>([[scheduleHostToken.id, {
      register(job: { id: string; cron: string }) {
        events.push(`register:${job.id}:${job.cron}`);
        return () => events.push(`dispose:${job.id}`);
      },
    }]]);
    const snapshot = {
      generation: 1,
      root: owner,
      tree: new Map([[owner, {
        id: owner,
        instanceKey: 'root',
        packageName: '@test/root',
        packageRoot: '/project',
        children: [],
      }]]),
      config: new Map([[owner, {}]]),
      resources: new Map([[owner, resources]]),
      capabilities: new Map([[slot.id, slot]]),
      projections: new Map(),
    } satisfies RuntimeSnapshot;
    const index = new ScheduleIndex([slot], snapshot);

    index.start();
    index.start();
    index.stop();
    expect(events).toEqual([
      'register:heartbeat:0 * * * * *',
      'dispose:heartbeat',
    ]);
  });
});
