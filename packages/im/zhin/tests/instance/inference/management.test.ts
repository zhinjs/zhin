import { setupInferenceManagement as setup } from './fixtures.js';

it('saves encrypted credentials and a stable receipt, and restores new fetch bindings after a local disconnect', async () => {
  const fixture = await setup();
  try {
    const account = fixture.graph.accounts.account!;
    await fixture.accounts.putKey({
      account,
      key: 'synthetic-key',
      expectedRevision: 0,
      authContractVersion: '1',
    });
    const old = fixture.accounts.bindFetch(
      account,
      vi.fn(async () => new Response('ok'))
    );
    await fixture.accounts.disconnect({ account, expectedRevision: 1, authContractVersion: '1' });
    await expect(old('https://example.test')).rejects.toBeInstanceOf(Error);
    const change = await fixture.management.prepareKey(fixture.principal, {
      accountId: 'account',
      key: 'synthetic-key',
      expectedRevision: 2,
    });
    expect(JSON.stringify(change)).not.toContain('synthetic-key');
    expect(
      await fixture.management.apply(fixture.principal, { prepared: change.prepared, mutationId: 'save-key' })
    ).toMatchObject({ status: 'committed', receipt: { graphRevision: 1 } });
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response('ok');
    });
    expect(await (await fixture.accounts.bindFetch(account, fetch)('https://example.test')).text()).toBe(
      'ok'
    );
    expect(
      await fixture.management.apply(fixture.principal, { prepared: change.prepared, mutationId: 'save-key' })
    ).toMatchObject({ status: 'committed', replayed: true });
    expect((await fixture.repository.readGraph({ rootId: '/root' }))?.revision).toBe(1);
  } finally {
    await fixture.close();
  }
});

it('exports a metadata-only importable plan with explicit bindings and rejects a personal Host environment source', async () => {
  const fixture = await setup();
  try {
    const exported = await fixture.management.export(fixture.principal);
    const reviewed = await fixture.management.review(fixture.principal, exported);
    expect(reviewed.changes).toEqual({
      services: { created: [], updated: [], removed: [] },
      accounts: { created: [], updated: [], removed: [] },
      profiles: { created: [], updated: [], removed: [] },
    });
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: reviewed.prepared,
        mutationId: 'roundtrip',
      })
    ).toMatchObject({ status: 'committed' });
    await expect(
      fixture.management.review(
        { ownerId: 'member', hostAdministrator: false },
        {
          plan: {
            version: 1,
            accounts: {
              personal: { service: 'shared', auth: { method: 'api-key', source: 'env://HOST_PRIVATE' } },
            },
          },
          bindings: { services: { shared: 'service' } },
        }
      )
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      fixture.management.apply(
        { ownerId: 'member', hostAdministrator: false },
        { prepared: reviewed.prepared, mutationId: 'cross-owner' }
      )
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(
      await fixture.repository.readMutation({ rootId: '/root', mutationId: 'cross-owner' })
    ).toBeUndefined();
  } finally {
    await fixture.close();
  }
});

it('commits explicit account deletion before cancelling its outstanding fetch and never revives it on receipt replay', async () => {
  const fixture = await setup();
  try {
    const account = fixture.graph.accounts.account!;
    const fetch = fixture.accounts.bindFetch(
      account,
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        return new Response('ok');
      })
    );
    const change = await fixture.management.review(fixture.principal, {
      plan: {
        version: 1,
        purposes: { chat: null },
        remove: { profiles: ['profile'], accounts: ['account'] },
      },
    });
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: change.prepared,
        mutationId: 'delete-account',
      })
    ).toMatchObject({ status: 'committed' });
    await expect(fetch('https://example.test')).rejects.toMatchObject({ code: 'disconnected' });
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: change.prepared,
        mutationId: 'delete-account',
      })
    ).toMatchObject({ status: 'committed', replayed: true });
    expect((await fixture.repository.readGraph({ rootId: '/root' }))?.accounts.account).toBeUndefined();
  } finally {
    await fixture.close();
  }
});

it('keeps a proved credential save result when post-commit state reconciliation cannot read storage', async () => {
  const fixture = await setup();
  try {
    const change = await fixture.management.prepareKey(fixture.principal, {
      accountId: 'account',
      key: 'synthetic-key',
      expectedRevision: 0,
    });
    const read = failReadsAfterCommit(fixture);
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: change.prepared,
        mutationId: 'save-during-read-failure',
      })
    ).toMatchObject({ status: 'committed', receipt: { graphRevision: 1 } });
    read.mockRestore();
    expect(await fixture.management.mutation(fixture.principal, 'save-during-read-failure')).toMatchObject({
      graphRevision: 1,
    });
    expect(await fixture.accounts.status(fixture.graph.accounts.account!)).toMatchObject({
      status: 'ready',
      revision: 1,
    });
  } finally {
    await fixture.close();
  }
});

it('an old account-removal receipt cancels only its old incarnation, including when reads fail after commit', async () => {
  const fixture = await setup();
  try {
    const original = fixture.graph.accounts.account!;
    const oldFetch = fixture.accounts.bindFetch(original, vi.fn());
    const change = await fixture.management.review(fixture.principal, {
      plan: {
        version: 1,
        purposes: { chat: null },
        remove: { profiles: ['profile'], accounts: ['account'] },
      },
    });
    const read = failReadsAfterCommit(fixture);
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: change.prepared,
        mutationId: 'remove-old',
      })
    ).toMatchObject({ status: 'committed' });
    await expect(oldFetch('https://example.test')).rejects.toMatchObject({ code: 'disconnected' });
    read.mockRestore();
    const current = (await fixture.repository.readGraph({ rootId: '/root' }))!;
    const replacement = { ...original, incarnation: 'different-real-account' };
    expect(
      await fixture.repository.commit({
        rootId: '/root',
        expectedRevision: current.revision,
        mutationId: 'new-account',
        fingerprint: 'new-account',
        graph: { ...current, revision: current.revision + 1, accounts: { account: replacement } },
        result: null,
      })
    ).toMatchObject({ status: 'committed' });
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response('new');
    });
    const newFetch = fixture.accounts.bindFetch(replacement, fetch);
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: change.prepared,
        mutationId: 'remove-old',
      })
    ).toMatchObject({ status: 'committed', replayed: true });
    expect(await (await newFetch('https://example.test')).text()).toBe('new');
    expect((await fixture.repository.readGraph({ rootId: '/root' }))?.accounts.account?.incarnation).toBe(
      'different-real-account'
    );
  } finally {
    await fixture.close();
  }
});

function failReadsAfterCommit(fixture: Awaited<ReturnType<typeof setup>>) {
  let committed = false;
  const transaction = fixture.db.transaction!.bind(fixture.db),
    read = fixture.repository.readGraph.bind(fixture.repository);
  vi.spyOn(fixture.db, 'transaction').mockImplementation(async (work) => {
    const result = await transaction(work);
    committed = true;
    return result;
  });
  return vi
    .spyOn(fixture.repository, 'readGraph')
    .mockImplementation((input) =>
      committed ? Promise.reject(new Error('synthetic post-commit read unavailable')) : read(input)
    );
}

it('does not submit a prepared mutation when receipt lookup is unavailable', async () => {
  const fixture = await setup();
  try {
    const change = await fixture.management.prepareKey(fixture.principal, {
      accountId: 'account',
      key: 'synthetic-key',
      expectedRevision: 0,
    });
    vi.spyOn(fixture.repository, 'readMutation').mockRejectedValue(new Error('synthetic lookup unavailable'));
    const commit = vi.spyOn(fixture.repository, 'commitCredentialMutation');
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: change.prepared,
        mutationId: 'unknown-prior',
      })
    ).toEqual({ status: 'commit-unknown' });
    expect(commit).not.toHaveBeenCalled();
    expect(
      await fixture.repository.readCredential({ rootId: '/root', accountId: 'account' })
    ).toBeUndefined();
  } finally {
    await fixture.close();
  }
});
