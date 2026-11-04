import { describe, expect, it } from 'vitest';
import { adapterFeatureId } from '@zhin.js/adapter';
import { runtimeSandboxOwners } from '../../src/plugin-runtime/start-command.js';

const index = (rows: Record<string, { owner: string; profile: object }>) => ({
  $projection: 'zhin.adapter-index/1',
  describe: () => Object.entries(rows).map(([id, row]) => ({ id, owner: row.owner })),
  capabilityProfile: (id: string) => rows[id]?.profile,
});
const snapshot = (adapters: object) => ({ projections: new Map([[adapterFeatureId, adapters]]) }) as never;

describe('runtimeSandboxOwners (ADR 0044 runtime.sandbox)', () => {
  it('collects only the plugins whose Endpoint profile declares runtime.sandbox', () => {
    const owners = runtimeSandboxOwners(snapshot(index({
      a: { owner: 'root/sandbox', profile: { default: { runtime: { sandbox: true } } } },
      b: { owner: 'root/other', profile: { default: { delivery: { send: true } } } },
      c: { owner: 'root/off', profile: { default: { runtime: { sandbox: false } } } },
    })));
    expect([...owners]).toEqual(['root/sandbox']);
  });

  it('is empty without an adapter index', () => {
    expect(runtimeSandboxOwners(undefined).size).toBe(0);
    expect(runtimeSandboxOwners({ projections: new Map() } as never).size).toBe(0);
  });
});
