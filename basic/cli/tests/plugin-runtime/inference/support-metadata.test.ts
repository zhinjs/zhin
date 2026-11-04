import { InferenceManagementService } from '../../../src/plugin-runtime/inference/management.js';
import { supportFixture } from './support-fixture.js';

it('projects exact held declarations without exposing extra support fields or invoking execution resolvers', async () => {
  const f = await supportFixture(),
    held = f.host.acquireManagement();
  const readCredential = vi.spyOn(f.host.repository, 'readCredential');
  const fetch = vi.spyOn(globalThis, 'fetch');
  try {
    const before = await f.host.repository.readGraph({ rootId: f.host.rootId });
    const receipt = await f.host.repository.readMutation({
      rootId: f.host.rootId,
      mutationId: 'initial',
    });
    const exported = await held.management.export(f.operator);
    const view = await held.management.view(f.member);
    expect(view.services).toEqual({});
    expect(view.accounts).toEqual({});
    expect(view.profiles).toEqual({});
    expect(view.deployment.map((row) => row.id).sort()).toEqual(
      Object.keys(f.graph.profiles).sort()
    );
    expect(view.deployment.find((row) => row.id === 'chosen')?.support).toEqual(
      { status: 'experimental', notice: 'Experimental fixture' }
    );
    expect(view.deployment.find((row) => row.id === 'other')?.support).toEqual({
      status: 'standard',
      notice: 'Other owner',
    });
    for (const id of ['stale', 'missing'])
      expect(view.deployment.find((row) => row.id === id)).not.toHaveProperty(
        'support'
      );
    expect(
      view.drivers.find((driver) => driver.owner === f.root)?.support
    ).toEqual({ status: 'experimental', notice: 'Experimental fixture' });
    expect(JSON.stringify(view)).not.toContain('not-public-support');
    expect(JSON.stringify(view)).not.toContain('not-a-member-service');
    expect(readCredential).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    f.next({ status: 'standard', notice: 'Next generation' });
    const current = f.host.acquireManagement();
    try {
      expect(
        (await held.management.view(f.member)).deployment.find(
          (row) => row.id === 'chosen'
        )?.support?.status
      ).toBe('experimental');
      expect(
        (await current.management.view(f.member)).deployment.find(
          (row) => row.id === 'chosen'
        )?.support
      ).toEqual({ status: 'standard', notice: 'Next generation' });
      expect(await current.management.export(f.operator)).toEqual(exported);
    } finally {
      await current.release();
    }
    expect(
      await f.host.repository.readGraph({ rootId: f.host.rootId })
    ).toEqual(before);
    expect(
      await f.host.repository.readMutation({
        rootId: f.host.rootId,
        mutationId: 'initial',
      })
    ).toEqual(receipt);
    expect(f.host.rootId).toBe(f.graph.rootId);
  } finally {
    fetch.mockRestore();
    await held.release();
    await f.close();
  }
});

it.each([
  { label: 'absent', support: undefined },
  { label: 'null', support: null },
  { label: 'array', support: [] },
  { label: 'status missing', support: { notice: 'No declared status' } },
  {
    label: 'status unknown',
    support: { status: 'official', notice: 'Do not infer support' },
  },
])(
  'keeps absent or malformed metadata undeclared ($label)',
  async ({ support }) => {
    const f = await supportFixture({ support }),
      held = f.host.acquireManagement();
    try {
      const view = await held.management.view(f.operator);
      expect(
        view.drivers.find((driver) => driver.owner === f.root)
      ).not.toHaveProperty('support');
      expect(
        view.deployment.find((row) => row.id === 'chosen')
      ).not.toHaveProperty('support');
      expect(view.statuses.chosen.status).toBe('ready');
    } finally {
      await held.release();
      await f.close();
    }
  }
);

it('omits a non-string notice while retaining the declared experimental status', async () => {
  const f = await supportFixture({
    support: {
      status: 'experimental',
      notice: { privateMarker: 'not-public-support' },
      token: 'not-public-support',
    },
  });
  const held = f.host.acquireManagement();
  try {
    const view = await held.management.view(f.member);
    expect(
      view.drivers.find((driver) => driver.owner === f.root)?.support
    ).toEqual({ status: 'experimental' });
    expect(view.deployment.find((row) => row.id === 'chosen')?.support).toEqual(
      { status: 'experimental' }
    );
    expect(JSON.stringify(view)).not.toContain('not-public-support');
  } finally {
    await held.release();
    await f.close();
  }
});

it('uses the existing declaration list once per view for every deployment Profile', async () => {
  const f = await supportFixture(),
    held = f.host.acquireManagement();
  try {
    const declared = (await held.management.view(f.operator)).drivers;
    const drivers = vi.fn(() => declared),
      execute = vi.fn(() => {
        throw new Error('Display is not execution');
      });
    const management = new InferenceManagementService({
      rootId: f.host.rootId,
      hostOwnerId: f.host.hostOwnerId,
      directory: f.directory,
      repository: f.host.repository,
      accounts: f.host.accounts,
      drivers,
      authenticationContract: execute,
      resolveService: execute,
      profileSchema: execute,
      discover: execute,
    });
    const view = await management.view(f.member);
    expect(view.deployment).toHaveLength(4);
    expect(drivers).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await held.release();
    await f.close();
  }
});
