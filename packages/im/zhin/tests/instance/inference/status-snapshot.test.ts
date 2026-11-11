import { setupInferenceManagement } from './fixtures.js';

it('projects one trusted graph for 100 accounts without repeating graph reads or skipping credential facts', async () => {
  const f = await setupInferenceManagement();
  try {
    const accounts = { ...f.graph.accounts };
    for (let i = 1; i < 100; i++)
      accounts[`account-${i}`] = {
        ...f.graph.accounts.account,
        id: `account-${i}`,
        incarnation: `identity-${i}`,
      };
    const graph = { ...f.graph, revision: 2, accounts };
    expect(
      await f.repository.commit({
        rootId: '/root',
        expectedRevision: 1,
        mutationId: 'many-accounts',
        fingerprint: 'many-accounts',
        graph,
        result: null,
      })
    ).toMatchObject({ status: 'committed' });
    const reads = vi.spyOn(f.repository, 'readGraph'),
      credentials = vi.spyOn(f.repository, 'readCredential');
    const view = await f.management.view(f.principal);
    expect(Object.keys(view.statuses)).toHaveLength(100);
    expect(reads).toHaveBeenCalledOnce();
    expect(credentials).toHaveBeenCalledTimes(100);
    for (const status of Object.values(view.statuses))
      expect(status).toEqual({ status: 'not-authorized', revision: 0 });
    for (const patch of [
      { rootId: '/other' },
      { ownerId: 'other' },
      { incarnation: 'different' },
      { serviceId: 'missing' },
    ]) {
      await expect(
        f.accounts.statuses({ graph, accounts: [{ ...accounts.account, ...patch }] })
      ).rejects.toMatchObject({ code: 'conflict' });
    }
  } finally {
    await f.close();
  }
});
