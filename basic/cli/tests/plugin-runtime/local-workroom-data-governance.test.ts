import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createLocalWorkroomDataGovernanceAuthority,
} from '../../src/plugin-runtime/local-workroom-data-governance.js';

describe('local Workroom Data Governance authority', () => {
  const context = {
    version: 1 as const,
    generation: 3,
    tenantId: 'tenant:project-1',
    projectId: 'project-1',
    objectId: 'source:1',
    descriptorDigest: `sha256:${'a'.repeat(64)}`,
    aadDigest: `sha256:${'b'.repeat(64)}`,
  };
  const decisionInput = {
    projectId: 'project-1',
    catalogRevision: 'catalog:1',
    catalogBindingDigest: `sha256:${'c'.repeat(64)}`,
    candidateDigest: `sha256:${'d'.repeat(64)}`,
    principalId: 'principal:sponsor',
    authorizedBy: 'sponsor' as const,
  };

  it('persists a private wrapping key and verifies only exact signed decisions', async () => {
    const root = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
    await mkdir(root);
    const authority = createLocalWorkroomDataGovernanceAuthority({ stateRoot: root, now: () => 42 });
    const signal = new AbortController().signal;
    const dataKey = new Uint8Array(32).fill(7);
    const wrapped = await authority.cryptography.wrap({ ...context, dataKey }, signal);

    expect(wrapped).not.toBeNull();
    expect(wrapped!.wrappedKey).not.toBe(Buffer.from(dataKey).toString('base64'));
    await expect(authority.cryptography.unwrap({ ...context, ...wrapped! }, signal))
      .resolves.toEqual(dataKey);

    const decision = await authority.issuePublicationDecision(decisionInput, signal);
    await expect(authority.verification.verify(decision, decision.candidateDigest)).resolves.toBe(true);
    await expect(authority.verification.verify(
      { ...decision, principalId: 'principal:attacker' },
      decision.candidateDigest,
    )).resolves.toBe(false);

    const keyPath = join(root, 'workroom-data-governance-root-key.json');
    expect(JSON.parse(await readFile(keyPath, 'utf8'))).toMatchObject({ version: 1 });
    if (process.platform !== 'win32') {
      expect((await stat(keyPath)).mode & 0o077).toBe(0);
    }
  });

  it('fails closed for wrong key ids, malformed ciphertext and changed authenticated context', async () => {
    const root = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
    await mkdir(root);
    const authority = createLocalWorkroomDataGovernanceAuthority({ stateRoot: root });
    const signal = new AbortController().signal;
    const wrapped = await authority.cryptography.wrap({
      ...context,
      dataKey: new Uint8Array(32).fill(9),
    }, signal);
    expect(wrapped).not.toBeNull();

    await expect(authority.cryptography.unwrap({
      ...context,
      ...wrapped!,
      keyId: 'local-file:sha256:wrong',
    }, signal)).resolves.toBeNull();
    await expect(authority.cryptography.unwrap({
      ...context,
      ...wrapped!,
      wrappedKey: 'not-a-wrapped-key',
    }, signal)).resolves.toBeNull();
    await expect(authority.cryptography.unwrap({
      ...context,
      ...wrapped!,
      objectId: 'source:attacker',
    }, signal)).resolves.toBeNull();

    const decision = await authority.issuePublicationDecision({
      ...decisionInput,
      expectedPreviousDigest: `sha256:${'e'.repeat(64)}`,
    }, signal);
    expect(decision.expectedPreviousDigest).toBe(`sha256:${'e'.repeat(64)}`);
    await expect(authority.verification.verify(
      decision,
      `sha256:${'f'.repeat(64)}`,
    )).resolves.toBe(false);
    await expect(authority.verification.verify({
      ...decision,
      decisionId: 'decision:unsigned',
    }, decision.candidateDigest)).resolves.toBe(false);
    await expect(authority.verification.verify({
      ...decision,
      decisionId: 'local-hmac:sha256:00',
    }, decision.candidateDigest)).resolves.toBe(false);
  });

  it('converges concurrent first-use authorities on one persisted Root key', async () => {
    const root = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
    await mkdir(root);
    const first = createLocalWorkroomDataGovernanceAuthority({ stateRoot: root });
    const second = createLocalWorkroomDataGovernanceAuthority({ stateRoot: root });
    const signal = new AbortController().signal;
    const request = { ...context, dataKey: new Uint8Array(32).fill(5) };
    const [firstWrapped, secondWrapped] = await Promise.all([
      first.cryptography.wrap(request, signal),
      second.cryptography.wrap(request, signal),
    ]);

    expect(firstWrapped?.keyId).toBe(secondWrapped?.keyId);
    await expect(first.cryptography.unwrap({ ...context, ...secondWrapped! }, signal))
      .resolves.toEqual(request.dataKey);
    await expect(second.cryptography.unwrap({ ...context, ...firstWrapped! }, signal))
      .resolves.toEqual(request.dataKey);
  });

  it('rejects invalid key documents and insecure POSIX permissions', async () => {
    const invalidRoot = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
    await mkdir(invalidRoot);
    await writeFile(join(invalidRoot, 'workroom-data-governance-root-key.json'), 'null\n', 'utf8');
    const invalid = createLocalWorkroomDataGovernanceAuthority({ stateRoot: invalidRoot });
    await expect(invalid.issuePublicationDecision(
      decisionInput,
      new AbortController().signal,
    )).rejects.toThrow('document is invalid');

    if (process.platform !== 'win32') {
      const insecureRoot = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
      await mkdir(insecureRoot);
      const authority = createLocalWorkroomDataGovernanceAuthority({ stateRoot: insecureRoot });
      await authority.issuePublicationDecision(decisionInput, new AbortController().signal);
      await chmod(join(insecureRoot, 'workroom-data-governance-root-key.json'), 0o644);
      const reopened = createLocalWorkroomDataGovernanceAuthority({ stateRoot: insecureRoot });
      await expect(reopened.issuePublicationDecision(
        decisionInput,
        new AbortController().signal,
      )).rejects.toThrow('permissions must be 0600');
    }
  });

  it('honors cancellation before cryptographic or signing work', async () => {
    const root = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
    await mkdir(root);
    const authority = createLocalWorkroomDataGovernanceAuthority({ stateRoot: root });
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(authority.cryptography.wrap({
      ...context,
      dataKey: new Uint8Array(32),
    }, controller.signal)).rejects.toThrow('cancelled');
    await expect(authority.issuePublicationDecision(decisionInput, controller.signal))
      .rejects.toThrow('cancelled');
  });

  it('provides signed lifecycle authorization, deletion receipts, and conservative orphan reconciliation', async () => {
    const root = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
    await mkdir(root);
    const authority = createLocalWorkroomDataGovernanceAuthority({ stateRoot: root, now: () => 73 });
    const lifecycle = authority.lifecycle;
    const clock = await lifecycle.clock.read();
    expect(clock).toMatchObject({ version: 1, now: 73, revision: 1 });

    const deniedRequest = {
      authenticatedPrincipalId: 'principal:attacker',
      requiredRole: 'data_steward',
      clock,
      digest: `sha256:${'1'.repeat(64)}`,
    } as never;
    await expect(lifecycle.authority.authorize(deniedRequest)).resolves.toEqual({
      approved: false,
      requestDigest: deniedRequest.digest,
      reason: 'local_root_principal_required',
    });

    const request = {
      ...deniedRequest,
      authenticatedPrincipalId: lifecycle.registrationPrincipalId,
      digest: `sha256:${'2'.repeat(64)}`,
    } as never;
    const decision = await lifecycle.authority.authorize(request);
    if (!decision.approved) throw new Error('fixture lifecycle decision must be approved');
    await expect(lifecycle.authority.verify(request, decision)).resolves.toBe(true);
    await expect(lifecycle.authority.verify(request, {
      ...decision,
      role: 'privacy',
    } as never)).resolves.toBe(false);
    await expect(lifecycle.subjects.resolve()).resolves.toBeUndefined();

    const dispatch = {
      id: 'purge-1',
      governance: { request: { projectId: 'project-1', objectId: 'object-1' } },
      location: {
        id: 'primary',
        authorityDigest: `sha256:${'3'.repeat(64)}`,
      },
      locationManifestDigest: `sha256:${'4'.repeat(64)}`,
      attempt: 1,
      fence: 1,
      requestDigest: `sha256:${'5'.repeat(64)}`,
      requestedAt: 50,
      digest: `sha256:${'6'.repeat(64)}`,
    } as never;
    const receipt = await lifecycle.deletion.purge(dispatch);
    expect(receipt).toMatchObject({
      purgeId: 'purge-1',
      projectId: 'project-1',
      objectId: 'object-1',
      status: 'failed',
      reasonCode: 'unsupported',
      authenticatedBy: lifecycle.registrationPrincipalId,
      observedAt: 73,
    });
    await expect(lifecycle.receipts.verify(receipt, dispatch)).resolves.toBe(true);
    await expect(lifecycle.receipts.verify({
      ...receipt,
      requestDigest: `sha256:${'7'.repeat(64)}`,
    }, dispatch)).resolves.toBe(false);

    const orphanRequest = { digest: `sha256:${'8'.repeat(64)}` } as never;
    const orphan = await lifecycle.orphanPurge.purge(orphanRequest);
    expect(orphan).toMatchObject({
      requestDigest: orphanRequest.digest,
      providerId: 'local-workroom-orphan-purge',
      status: 'outcome_unknown',
      observedAt: 73,
    });
    await expect(lifecycle.orphanPurge.reconcile(orphanRequest, orphan)).resolves.toBe(orphan);
    await expect(lifecycle.orphanPurge.reconcile(orphanRequest, {
      ...orphan,
      requestDigest: `sha256:${'9'.repeat(64)}`,
    })).resolves.toEqual(orphan);
  });
});
