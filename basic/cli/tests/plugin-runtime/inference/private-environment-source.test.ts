import { credentialMaterialFingerprint } from '../../../src/plugin-runtime/inference/credentials.js';
import { setupInferenceManagement } from './fixtures.js';

it.each([
  { literal: '${SYNTHETIC:-private-fallback}', expected: 'private-fallback', repair: true },
  { literal: 'real-provider-key', expected: 'private-fallback', repair: false },
  { literal: '${OTHER:-private-fallback}', expected: 'private-fallback', repair: false },
])('explicit source repair only clears the fingerprint of the exact template: $literal', async ({ literal, expected, repair }) => {
  const fixture = await setupInferenceManagement();
  const expression = '${SYNTHETIC:-private-fallback}';
  const account = fixture.graph.accounts.account;
  try {
    const record = await fixture.store.seal({ account, revision: 1, authContractVersion: '1', payload: {
      status: 'ready', method: 'api-key', key: literal, materialFingerprint: credentialMaterialFingerprint(literal),
      subject: 'independently-verified-subject',
    } });
    await fixture.repository.commitCredential({ rootId: '/root', write: { accountId: account.id, expectedRevision: 0, expectedIncarnation: account.incarnation, record } });
    const preview = await fixture.management.prepareKey(fixture.principal, { accountId: account.id, key: expression, expectedRevision: 1 });
    expect(fixture.resolveSource).not.toHaveBeenCalled();
    expect(JSON.stringify(preview)).not.toMatch(/SYNTHETIC|private-fallback/);
    expect(await fixture.management.apply(fixture.principal, { prepared: preview.prepared, mutationId: 'repair' })).toMatchObject({ status: 'committed' });
    const configured = await fixture.store.read(account);
    expect(configured?.payload).toMatchObject({ source: { kind: 'environment-expression', expression }, subject: 'independently-verified-subject' });
    if (repair) expect(configured?.payload.materialFingerprint).toBeUndefined();
    else expect(configured?.payload.materialFingerprint).toBe(credentialMaterialFingerprint(literal));
    fixture.resolveSource.mockReturnValue(expected);
    const authorization = fixture.accounts.createAccountPort({ account, service: fixture.graph.services.service, definition: fixture.definition,
      retainDriver: () => ({ reference: fixture.graph.services.service.driver, definition: fixture.definition, release() {} }), purpose: 'inference' })
      .authorize({ target: new URL('https://example.test/v1'), signal: new AbortController().signal });
    if (repair) {
      expect(await authorization).toMatchObject({ token: expected });
      expect((await fixture.store.read(account))?.payload).toMatchObject({ materialFingerprint: credentialMaterialFingerprint(expected), subject: 'independently-verified-subject' });
    } else await expect(authorization).rejects.toMatchObject({ code: 'identity-change' });
    expect(fixture.resolveSource).toHaveBeenCalledOnce();
    expect(JSON.stringify(await fixture.management.view(fixture.principal))).not.toMatch(/private-fallback|independently-verified-subject/);
  } finally { await fixture.close(); }
});

it.each(['credential-revision', 'account-incarnation'])('refuses a prepared private source repair after %s changes', async change => {
  const fixture = await setupInferenceManagement();
  const account = fixture.graph.accounts.account;
  try {
    await fixture.accounts.putKey({ account, key: 'real-key', expectedRevision: 0, authContractVersion: '1' });
    const preview = await fixture.management.prepareKey(fixture.principal, { accountId: account.id,
      source: { kind: 'environment-expression', expression: '${SYNTHETIC:-private-fallback}' }, expectedRevision: 1 });
    if (change === 'credential-revision') await fixture.accounts.disconnect({ account, expectedRevision: 1, authContractVersion: '1' });
    else await fixture.repository.commit({ rootId: '/root', expectedRevision: 1, mutationId: 'replace', fingerprint: 'replace',
      graph: { ...fixture.graph, revision: 2, accounts: { account: { ...account, incarnation: 'replacement' } } }, result: null });
    expect(await fixture.management.apply(fixture.principal, { prepared: preview.prepared, mutationId: 'stale-repair' })).toMatchObject({ status: 'conflict' });
    expect(fixture.resolveSource).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});
