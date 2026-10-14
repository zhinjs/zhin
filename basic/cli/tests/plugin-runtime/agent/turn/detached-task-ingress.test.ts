import { describe, expect, it } from 'vitest';
import { DetachedTaskRunner, InMemoryDetachedTaskStore, detachedTaskRunnerToken } from '@zhin.js/agent';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { resolveSnapshotDetachedTaskRunner } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';

describe('detached task runner resolution (#732)', () => {
  it('reads the runner a plugin provides under detachedTaskRunnerToken', () => {
    const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: {} });
    const requester = rootPluginId();
    const snapshot = { resources: new Map([[requester, new Map([[detachedTaskRunnerToken.id, runner]])]]) };
    expect(resolveSnapshotDetachedTaskRunner(snapshot as never, requester)).toBe(runner);
  });

  it('is off when nothing (or something unrelated) is provided', () => {
    const requester = rootPluginId();
    expect(resolveSnapshotDetachedTaskRunner({ resources: new Map() } as never, requester)).toBeUndefined();
    const bogus = { resources: new Map([[requester, new Map([[detachedTaskRunnerToken.id, {}]])]]) };
    expect(resolveSnapshotDetachedTaskRunner(bogus as never, requester)).toBeUndefined();
  });
});
