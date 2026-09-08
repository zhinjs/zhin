import { vi } from 'vitest';
import { createGitHubWorkroomCapability } from '../../src/plugin-runtime/github-workroom-capability.js';
import { ProductionGitWorkroomEffectGateway } from '../../src/plugin-runtime/workroom-effect-production.js';
import { createGitWorkspaceLease } from '../../src/workroom/git-workspace-gateway.js';
import { MemoryWorkroomEffectJournal, WorkroomEffectLedger, createWorkroomEffectIntent } from '../../src/workroom/effect-ledger.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

async function fixture(kind: 'git_push' | 'git_open_pr' = 'git_push') {
  const lease = createGitWorkspaceLease({ leaseRef: 'workspace:1', projectId: 'project', runId: 'run', taskKey: 'fix',
    taskRevision: 1, assignmentId: 'assignment', attempt: 1, fence: 1,
    repository: { id: 'github:owner/repo', bindingRef: 'binding:1', bindingDigest: digest('binding') },
    baseSha: 'a'.repeat(40), targetRef: 'refs/heads/main', attemptBranch: 'refs/heads/zhin/run/assignment/attempt-1',
    pathScopes: ['src/'], mode: 'pull_request', expiresAt: 100 });
  const operation = kind === 'git_push'
    ? { kind, parameters: { repositoryId: lease.repository.id, ref: lease.attemptBranch, headSha: 'b'.repeat(40), changedPaths: ['src/index.ts'] } }
    : { kind, parameters: { repositoryId: lease.repository.id, headRef: lease.attemptBranch, baseRef: lease.targetRef, headSha: 'b'.repeat(40) } };
  const intent = createWorkroomEffectIntent({ projectId: 'project', runId: 'run', taskKey: 'fix', taskRevision: 1,
    candidateHash: digest('candidate'), capability: { ref: 'github:capability', digest: digest('capability') },
    operation, target: { ref: lease.leaseRef, digest: lease.digest }, preconditions: [],
    risk: { assessmentRef: 'risk:1', assessmentDigest: digest('risk'), tier: 'high' },
    reversibility: { kind: 'discard_only' }, idempotencyKey: 'delivery:1', createdAt: 10 });
  const journal = new MemoryWorkroomEffectJournal();
  const ledger = new WorkroomEffectLedger(journal, { authorize: async ({ intent }) => ({ version: 1, authorized: true,
    intentId: intent.id, intentDigest: intent.digest, candidateHash: intent.candidateHash,
    authorizationId: 'auth:1', authorizationDigest: digest('auth'),
    policy: { id: 'policy:1', revision: 1, digest: digest('policy') }, authorizedBy: 'sponsor:1', expiresAt: 100 }) });
  await ledger.recordIntent('project', intent);
  const state = await ledger.startAuthorizedAttempt('project', intent.id, { operationId: 'operation:1', workerId: 'worker', fence: 1, startedAt: 20 });
  return { lease, intent, state, journal };
}

describe('GitHub Workroom production capability recovery', () => {
  it('replays an executing effect and reconciles its exact ref after the lease expires without writing', async () => {
    const { lease, intent, journal } = await fixture();
    const ledger = new WorkroomEffectLedger(journal);
    const state = await ledger.read('project', intent.id);
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ref: lease.attemptBranch, object: { type: 'commit', sha: 'b'.repeat(40) } }))
      .mockResolvedValueOnce(Response.json(comparison()));
    const resolve = vi.fn(async () => ({ credentialId: 'installation:2', secret: 'never-persist', expiresAt: 1_000 }));
    const capability = createGitHubWorkroomCapability({ binding: { ref: 'github:capability', digest: digest('capability') }, fetch, credentials: { resolve }, now: () => 200 });
    const gateway = new ProductionGitWorkroomEffectGateway({ generation: 2, now: () => 200,
      resolveLease: () => ({ resolve: async () => lease }), resolveProtection: () => undefined, resolveCapability: () => capability });
    const receipt = await gateway.reconcile(state, new AbortController().signal);
    await expect(ledger.recordReceipt('project', intent.id, receipt)).resolves.toMatchObject({ status: 'committed' });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ generation: 2, leaseDigest: lease.digest }), expect.any(AbortSignal));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain('never-persist');
  });

  it('keeps provider absence unknown and later observes the committed ref', async () => {
    const { lease, state } = await fixture();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ ref: lease.attemptBranch, object: { type: 'commit', sha: 'b'.repeat(40) } }))
      .mockResolvedValueOnce(Response.json(comparison()));
    const capability = createGitHubWorkroomCapability({ binding: { ref: 'github:capability', digest: digest('capability') }, fetch, now: () => 200,
      credentials: { resolve: async () => ({ credentialId: 'app:1', secret: 'x', expiresAt: 1_000 }) } });
    const input = { generation: 2, state, lease };
    await expect(capability.reconcile(input, new AbortController().signal)).resolves.toMatchObject({ outcome: 'outcome_unknown' });
    await expect(capability.reconcile(input, new AbortController().signal)).resolves.toMatchObject({ outcome: 'committed' });
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('recovers a previously created PR using the same marker as the execution gateway', async () => {
    const { lease, state } = await fixture('git_open_pr');
    const request = { operationId: 'operation:1', repositoryId: lease.repository.id,
      headRef: lease.attemptBranch, baseRef: lease.targetRef, headSha: 'b'.repeat(40),
      baseSha: lease.baseSha, pathScopes: lease.pathScopes,
      idempotencyKey: `git-pr:${lease.digest}:operation:1` };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json([{ number: 7,
      body: `<!-- zhin-workroom:${digest(request)} -->`, state: 'open',
      head: { ref: lease.attemptBranch.slice(11), sha: 'b'.repeat(40), repo: { full_name: 'owner/repo' } },
      base: { ref: 'main', repo: { full_name: 'owner/repo' } } }])).mockResolvedValueOnce(Response.json(comparison()));
    const capability = createGitHubWorkroomCapability({ binding: { ref: 'github:capability', digest: digest('capability') }, fetch, now: () => 200,
      credentials: { resolve: async () => ({ credentialId: 'app:1', secret: 'x', expiresAt: 1_000 }) } });
    await expect(capability.reconcile({ generation: 2, state, lease }, new AbortController().signal))
      .resolves.toMatchObject({ outcome: 'committed', remoteRef: 'https://api.github.com/repos/owner/repo/pulls/7' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not recover a durable attempt as committed when its observed commit is outside scope', async () => {
    const { lease, intent, journal } = await fixture();
    const ledger = new WorkroomEffectLedger(journal);
    const state = await ledger.read('project', intent.id);
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ref: lease.attemptBranch, object: { type: 'commit', sha: 'b'.repeat(40) } }))
      .mockResolvedValueOnce(Response.json({ ...comparison(), files: [{ filename: 'secrets/key', status: 'modified' }] }));
    const capability = createGitHubWorkroomCapability({ binding: intent.capability, fetch, now: () => 200,
      credentials: { resolve: async () => ({ credentialId: 'app:1', secret: 'x', expiresAt: 1_000 }) } });
    const gateway = new ProductionGitWorkroomEffectGateway({ generation: 2, now: () => 200,
      resolveLease: () => ({ resolve: async () => lease }), resolveProtection: () => undefined, resolveCapability: () => capability });
    await expect(gateway.reconcile(state, new AbortController().signal)).rejects.toThrow('outside');
    expect((await ledger.read('project', intent.id)).status).toBe('executing');
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('defaults to the transport identity and rejects a different logical capability before credential resolution', async () => {
    const { lease, state } = await fixture();
    const resolve = vi.fn();
    const capability = createGitHubWorkroomCapability({ credentials: { resolve } });
    expect(capability.binding).toEqual({ ref: capability.provider.id, digest: capability.provider.digest });
    await expect(capability.reconcile({ generation: 2, state, lease }, new AbortController().signal))
      .rejects.toThrow('capability binding drift');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a lease join drift before resolving credentials or calling GitHub', async () => {
    const { lease, state } = await fixture();
    const resolve = vi.fn();
    const fetch = vi.fn();
    const capability = createGitHubWorkroomCapability({ binding: { ref: 'github:capability', digest: digest('capability') }, fetch, credentials: { resolve } });
    await expect(capability.reconcile({ generation: 2, state, lease: { ...lease, taskRevision: 2 } }, new AbortController().signal))
      .rejects.toThrow('exact authorized');
    expect(resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

function comparison() {
  return { status: 'ahead', base_commit: { sha: 'a'.repeat(40) }, merge_base_commit: { sha: 'a'.repeat(40) },
    files: [{ filename: 'src/index.ts', status: 'modified' }] };
}
