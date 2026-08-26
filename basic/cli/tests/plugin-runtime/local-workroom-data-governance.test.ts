import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createLocalWorkroomDataGovernanceAuthority,
} from '../../src/plugin-runtime/local-workroom-data-governance.js';

describe('local Workroom Data Governance authority', () => {
  it('persists a private wrapping key and verifies only exact signed decisions', async () => {
    const root = join(tmpdir(), `zhin-local-workroom-governance-${randomUUID()}`);
    await mkdir(root);
    const authority = createLocalWorkroomDataGovernanceAuthority({ stateRoot: root, now: () => 42 });
    const signal = new AbortController().signal;
    const context = {
      version: 1 as const,
      generation: 3,
      tenantId: 'tenant:project-1',
      projectId: 'project-1',
      objectId: 'source:1',
      descriptorDigest: `sha256:${'a'.repeat(64)}`,
      aadDigest: `sha256:${'b'.repeat(64)}`,
    };
    const dataKey = new Uint8Array(32).fill(7);
    const wrapped = await authority.cryptography.wrap({ ...context, dataKey }, signal);

    expect(wrapped).not.toBeNull();
    expect(wrapped!.wrappedKey).not.toBe(Buffer.from(dataKey).toString('base64'));
    await expect(authority.cryptography.unwrap({ ...context, ...wrapped! }, signal))
      .resolves.toEqual(dataKey);

    const decision = await authority.issuePublicationDecision({
      projectId: 'project-1',
      catalogRevision: 'catalog:1',
      catalogBindingDigest: `sha256:${'c'.repeat(64)}`,
      candidateDigest: `sha256:${'d'.repeat(64)}`,
      principalId: 'principal:sponsor',
      authorizedBy: 'sponsor',
    }, signal);
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
});
