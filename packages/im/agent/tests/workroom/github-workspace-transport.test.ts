import { vi } from 'vitest';
import { GitHubWorkspaceTransport } from '../../src/workroom/github-workspace-transport.js';
import { GitWorkspaceGateway, createGitWorkspaceLease } from '../../src/workroom/git-workspace-gateway.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const headSha = 'b'.repeat(40);
const baseSha = 'a'.repeat(40);
const headRef = 'refs/heads/zhin/run/assignment/attempt-1';
const credential = { credentialId: 'installation:1', secret: 'private-token', expiresAt: 10_000 };
const signal = () => new AbortController().signal;
const push = { operationId: 'op-1', repositoryId: 'github:owner/repo', ref: headRef, headSha,
  baseSha, pathScopes: ['src/'], force: false as const, idempotencyKey: 'push:1' };
const pr = { operationId: 'pr-1', repositoryId: 'github:owner/repo', headRef,
  baseRef: 'refs/heads/main', headSha, baseSha, pathScopes: ['src/'], idempotencyKey: 'pr:1' };
const marker = `<!-- zhin-workroom:${digest(pr)} -->`;
function ref(sha = headSha) { return { ref: headRef, object: { type: 'commit', sha } }; }
function pull(overrides: Record<string, unknown> = {}) {
  return { number: 12, body: marker, state: 'open',
    head: { ref: headRef.slice(11), sha: headSha, repo: { full_name: 'owner/repo' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } }, ...overrides };
}
function comparison(files: unknown[] = [{ filename: 'src/index.ts', status: 'modified' }]) {
  return { status: 'ahead', base_commit: { sha: baseSha }, merge_base_commit: { sha: baseSha }, files };
}
function http(...responses: (Response | Error | unknown)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (!responses.length) throw new Error('unexpected request');
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return result instanceof Response ? result : Response.json(result);
  });
  return { fetch, transport: new GitHubWorkspaceTransport({ fetch }) };
}

describe('GitHub Workspace REST transport', () => {
  it('publishes only an existing commit after authenticating its actual diff and creates a non-force ref', async () => {
    const { fetch, transport } = http(comparison(), new Response('', { status: 404 }), ref());
    const receipt = await transport.push(push, credential, signal());
    expect(receipt).toMatchObject({ headSha, ref: headRef, repositoryId: push.repositoryId });
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`https://api.github.com/repos/owner/repo/compare/${baseSha}...${headSha}`, 'GET'],
      [`https://api.github.com/repos/owner/repo/git/ref/heads/zhin/run/assignment/attempt-1`, 'GET'],
      ['https://api.github.com/repos/owner/repo/git/refs', 'POST'],
    ]);
    expect(fetch.mock.calls[2][1]).toMatchObject({ redirect: 'error', body: JSON.stringify({ ref: headRef, sha: headSha }) });
    expect(JSON.stringify(receipt)).not.toContain(credential.secret);
  });

  it('updates an existing attempt branch without force and avoids a write when the SHA is already present', async () => {
    const update = http(comparison(), ref(baseSha), ref());
    await update.transport.push(push, credential, signal());
    expect(update.fetch.mock.calls[2][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ sha: headSha, force: false }) });
    const repeat = http(comparison(), ref());
    await repeat.transport.push(push, credential, signal());
    expect(repeat.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ filename: 'secrets/key', status: 'modified' }],
    [{ filename: 'src/key', status: 'renamed', previous_filename: 'secrets/key' }],
    Array.from({ length: 300 }, () => ({ filename: 'src/index.ts', status: 'modified' })),
  ])('refuses hidden out-of-scope changes or truncated evidence before any write', async (...files) => {
    const { fetch, transport } = http(comparison(files));
    await expect(transport.push(push, credential, signal())).rejects.toThrow(/outside|truncated/u);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a candidate that is not a descendant of the leased base', async () => {
    const { fetch, transport } = http({ ...comparison(), merge_base_commit: { sha: 'c'.repeat(40) } });
    await expect(transport.push(push, credential, signal())).rejects.toThrow('exact workspace base');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('creates a draft PR bound to exact operation, repository and head, then recovers a lost response without a second POST', async () => {
    const first = http([], comparison(), ref(), new Error('network timeout private-token'));
    await expect(first.transport.openPullRequest(pr, credential, signal())).rejects.toThrow('reconcile');
    expect(first.fetch.mock.calls[3][1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String(first.fetch.mock.calls[3][1]?.body));
    expect(body).toMatchObject({ draft: true, body: marker, head: headRef.slice(11), base: 'main' });
    // A new process/generation discovers the provider-side operation marker.
    const recovered = http([pull()], comparison());
    await expect(recovered.transport.openPullRequest(pr, credential, signal())).resolves.toMatchObject({ prHeadSha: headSha });
    expect(recovered.fetch).toHaveBeenCalledTimes(2);
    expect(recovered.fetch.mock.calls[0][1]?.method).toBe('GET');
  });

  it('keeps a missing or moved ref unresolved instead of declaring that a write failed', async () => {
    const { transport, fetch } = http(new Response('', { status: 404 }), ref('c'.repeat(40)));
    await expect(transport.queryPush(push, credential, signal())).resolves.toBeUndefined();
    await expect(transport.queryPush(push, credential, signal())).resolves.toBeUndefined();
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it.each([
    { head: { ref: headRef.slice(11), sha: 'c'.repeat(40), repo: { full_name: 'owner/repo' } } },
    { head: { ref: headRef.slice(11), sha: headSha, repo: { full_name: 'attacker/repo' } } },
    { base: { ref: 'production', repo: { full_name: 'owner/repo' } } },
  ])('rejects PR observations that drift from the exact authorized candidate', async (override) => {
    const { transport } = http([pull(override)]);
    await expect(transport.queryPullRequest(pr, credential, signal())).rejects.toThrow('binding drift');
  });

  it('refuses to adopt an existing PR from a different operation', async () => {
    const { transport, fetch } = http([pull({ body: 'an unrelated request' })]);
    await expect(transport.openPullRequest(pr, credential, signal())).rejects.toThrow('different operation');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails closed if the branch advances before PR creation', async () => {
    const { transport, fetch } = http([], comparison(), ref('c'.repeat(40)));
    await expect(transport.openPullRequest(pr, credential, signal())).rejects.toThrow('head SHA drift');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a rejected/unknown write or leak provider error bodies', async () => {
    const { transport, fetch } = http([], comparison(), ref(), new Response('private-token', { status: 422 }));
    await expect(transport.openPullRequest(pr, credential, signal())).rejects.toThrow('HTTP 422; reconcile');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('checks actual path scopes when opening a PR without a preceding push', async () => {
    const { transport, fetch } = http([], comparison([{ filename: 'secrets/key', status: 'modified' }]));
    await expect(transport.openPullRequest(pr, credential, signal())).rejects.toThrow('outside');
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('validates the provider response after a successful PR creation', async () => {
    const success = http([], comparison(), ref(), pull());
    await expect(success.transport.openPullRequest(pr, credential, signal())).resolves.toMatchObject({ prHeadSha: headSha });
    const raced = http([], comparison(), ref(), pull({ head: { ref: headRef.slice(11), sha: baseSha, repo: { full_name: 'owner/repo' } } }));
    await expect(raced.transport.openPullRequest(pr, credential, signal())).rejects.toThrow('binding drift');
  });

  it('never follows redirect responses or accepts URL traversal in repository IDs', async () => {
    const { transport, fetch } = http(new Response('', { status: 302, headers: { location: 'https://attacker.example/token' } }));
    await expect(transport.queryPush(push, credential, signal())).rejects.toThrow('HTTP 302');
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(transport.queryPush({ ...push, repositoryId: 'github:../repo' }, credential, signal())).rejects.toThrow('repository ID');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => new GitHubWorkspaceTransport({ apiBaseUrl: 'http://api.github.com' })).toThrow('HTTPS');
  });

  it.each(['push', 'pr'])('recovery rejects matching %s state whose commit has never passed scope validation', async (kind) => {
    const { transport, fetch } = http(kind === 'push' ? ref() : [pull()], comparison([{ filename: 'secrets/key', status: 'modified' }]));
    await expect(kind === 'push' ? transport.queryPush(push, credential, signal()) : transport.queryPullRequest(pr, credential, signal()))
      .rejects.toThrow('outside');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('does not interpret cancellation as branch deletion or PR closure', async () => {
    const { transport, fetch } = http();
    await expect(transport.cancel({ operationId: 'cancel', repositoryId: pr.repositoryId,
      remoteOperationId: 'remote', idempotencyKey: 'cancel:1' }, credential, signal())).rejects.toThrow('cannot be cancelled');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not dispatch after credential resolution expires the workspace lease', async () => {
    const lease = createGitWorkspaceLease({ leaseRef: 'lease:1', projectId: 'project', runId: 'run', taskKey: 'fix',
      taskRevision: 1, assignmentId: 'assignment', attempt: 1, fence: 1,
      repository: { id: pr.repositoryId, bindingRef: 'binding:1', bindingDigest: digest('binding') },
      baseSha, targetRef: pr.baseRef, attemptBranch: headRef, pathScopes: ['src/'], mode: 'pull_request', expiresAt: 100 });
    let now = 90;
    const { transport, fetch } = http();
    const gateway = new GitWorkspaceGateway({ generation: 1, now: () => now, transport,
      credentials: { resolve: async () => { now = 101; return credential; } } });
    await expect(gateway.openPullRequest({ operationId: 'pr-1', lease, fence: 1, headRef,
      baseRef: pr.baseRef, headSha }, signal())).rejects.toThrow('Lease is expired');
    expect(fetch).not.toHaveBeenCalled();
  });
});
