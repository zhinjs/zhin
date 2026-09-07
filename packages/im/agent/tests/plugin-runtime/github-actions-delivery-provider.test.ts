import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubActionsDeliveryProvider } from '../../src/plugin-runtime/github-actions-delivery-provider.js';
import type { WorkroomDeliveryDispatch } from '../../src/plugin-runtime/workroom-delivery-gateway.js';

const sha = 'a'.repeat(40), head = 'b'.repeat(40);
const bytes = Buffer.from('real archive bytes in the HTTP fixture');
const artifactDigest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'actions-provider-')); directories.push(directory);
  const build = { id: 10, workflow_id: 5, path: '.github/workflows/self-delivery-candidate.yml', head_sha: sha, run_attempt: 1, event: 'workflow_dispatch', display_title: `self-delivery:build:${head}`, status: 'completed', conclusion: 'success', repository: { id: 42 }, head_repository: { id: 42 }, actor: { id: 7 } };
  const artifact = { id: 12, name: `candidate-${head}-1`, expired: false, digest: artifactDigest, size_in_bytes: bytes.length, workflow_run: { id: 10, repository_id: 42, head_repository_id: 42, head_sha: sha } };
  const state = { build, artifact, buildJobs: [{ name: 'build', run_id: 10, run_attempt: 1, head_sha: sha, status: 'completed', conclusion: 'success' }], smokeJobs: [{ name: 'smoke', run_id: 20, run_attempt: 1, head_sha: sha, status: 'completed', conclusion: 'success' }], runs: [] as typeof build[], posts: 0, loseResponse: false, corruptBytes: false, movedRef: false };
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input), route = new URL(url).pathname;
    if (url === 'https://storage.example.test/archive') {
      expect(init?.headers).toBeUndefined();
      return new Response(state.corruptBytes ? Buffer.from('wrong bytes') : bytes);
    }
    if (init?.method === 'POST') {
      state.posts++;
      const body = JSON.parse(String(init.body));
      expect(body.ref).toBe('refs/tags/self-delivery-v1');
      expect(body.inputs.artifact_digest).toBe(artifactDigest);
      state.runs = [{ ...build, id: 20, display_title: `self-delivery:smoke:${body.inputs.operation_key}:${head}:${artifactDigest}` }];
      if (state.loseResponse) throw new Error('response lost after GitHub accepted request');
      return new Response(null, { status: 204 });
    }
    let data: unknown;
    if (route.endsWith('/actions/runs/10')) data = state.build;
    else if (route.endsWith('/actions/runs/10/attempts/1/jobs')) data = { total_count: state.buildJobs.length, jobs: state.buildJobs };
    else if (route.endsWith('/actions/runs/20/attempts/1/jobs')) data = { total_count: state.smokeJobs.length, jobs: state.smokeJobs };
    else if (route.endsWith('/actions/artifacts/12/zip')) return new Response(null, { status: 302, headers: { location: 'https://storage.example.test/archive' } });
    else if (route.endsWith('/actions/artifacts/12')) data = state.artifact;
    else if (route.includes('/commits/')) data = { sha: state.movedRef ? head : sha };
    else if (route.endsWith('/actions/workflows/5/runs')) data = { total_count: state.runs.length, workflow_runs: state.runs };
    else throw new Error(`Unexpected HTTP route ${url}`);
    return Response.json(data);
  });
  const options = { repository: 'zhinjs/zhin', repositoryId: 42, workflowId: 5, workflowPath: '.github/workflows/self-delivery-candidate.yml', workflowRef: 'refs/tags/self-delivery-v1', workflowSha: sha, actorIds: [7], requiredBuildJobs: ['build'], requiredSmokeJobs: ['smoke'], claimDirectory: directory, token: async () => 'test-service-token', resolveCandidate: async () => ({ runId: 10, runAttempt: 1, artifactId: 12, artifactName: artifact.name }), fetch: transport, now: () => 1000 };
  const provider = new GitHubActionsDeliveryProvider(options);
  const request: WorkroomDeliveryDispatch = { projectId: 'project', effectId: 'effect', intentDigest: 'intent', candidateHash: 'candidate', target: { repositoryId: '42', headSha: head, artifactDigest, environment: 'github-actions-smoke', pipelineRef: `.github/workflows/self-delivery-candidate.yml@${sha}` }, targetRef: 'target', targetDigest: 'target-digest', idempotencyKey: 'operation-1', attemptId: 'attempt-1', fence: 1, authorizationDigest: 'authorization', authorizationExpiresAt: 2000 };
  return { provider, options, request, state, transport, signal: new AbortController().signal };
}
it('verifies archive bytes and exact workflow/attempt/job provenance then executes smoke', async () => {
  const f = await fixture();
  const evidence = await f.provider.inspect(f.request, f.signal);
  expect(evidence.checks).toEqual([{ id: '10:1:build', status: 'passed' }]);
  const result = await f.provider.dispatch({ ...f.request, ...evidence }, f.signal);
  expect(result.status).toBe('succeeded'); expect(result.health).toBe('passed'); expect(f.state.posts).toBe(1);
});
it('persists claim across restart and only queries after a lost dispatch response', async () => {
  const f = await fixture(); const evidence = await f.provider.inspect(f.request, f.signal); f.state.loseResponse = true;
  expect((await f.provider.dispatch({ ...f.request, ...evidence }, f.signal)).status).toBe('unknown');
  const restarted = new GitHubActionsDeliveryProvider(f.options);
  expect((await restarted.dispatch({ ...f.request, ...evidence, authorizationExpiresAt: 0 }, f.signal)).status).toBe('succeeded');
  expect(f.state.posts).toBe(1);
  f.state.runs = [];
  expect((await restarted.dispatch({ ...f.request, ...evidence }, f.signal)).status).toBe('unknown');
  expect(f.state.posts).toBe(1);
});
it('serializes concurrent dispatches to one remote submission', async () => {
  const f = await fixture(); const evidence = await f.provider.inspect(f.request, f.signal);
  await Promise.allSettled([f.provider.dispatch({ ...f.request, ...evidence }, f.signal), f.provider.dispatch({ ...f.request, ...evidence }, f.signal)]);
  expect(f.state.posts).toBe(1);
});
it.each(['missing', 'duplicate', 'foreign'] as const)('rejects %s required jobs', async kind => {
  const f = await fixture();
  if (kind === 'missing') f.state.buildJobs = [];
  if (kind === 'duplicate') f.state.buildJobs.push(f.state.buildJobs[0]!);
  if (kind === 'foreign') f.state.buildJobs[0]!.head_sha = head;
  await expect(f.provider.inspect(f.request, f.signal)).rejects.toThrow();
});
it.each(['skipped', 'cancelled', 'failure'])('does not authorize %s checks', async conclusion => {
  const f = await fixture(); f.state.buildJobs[0]!.conclusion = conclusion;
  const evidence = await f.provider.inspect(f.request, f.signal);
  await expect(f.provider.dispatch({ ...f.request, ...evidence }, f.signal)).rejects.toThrow('evidence');
  expect(f.state.posts).toBe(0);
});
it.each(['sha', 'event', 'actor', 'attempt', 'repository', 'artifact', 'bytes'] as const)('rejects changed %s provenance', async kind => {
  const f = await fixture();
  if (kind === 'sha') f.state.build.head_sha = head;
  if (kind === 'event') f.state.build.event = 'pull_request';
  if (kind === 'actor') f.state.build.actor.id = 8;
  if (kind === 'attempt') f.state.build.run_attempt = 2;
  if (kind === 'repository') f.state.build.head_repository.id = 99;
  if (kind === 'artifact') f.state.artifact.expired = true;
  if (kind === 'bytes') f.state.corruptBytes = true;
  await expect(f.provider.inspect(f.request, f.signal)).rejects.toThrow();
});
it('rejects moved workflow ref before creating an operation', async () => {
  const f = await fixture(); const evidence = await f.provider.inspect(f.request, f.signal); f.state.movedRef = true;
  await expect(f.provider.dispatch({ ...f.request, ...evidence }, f.signal)).rejects.toThrow('ref moved'); expect(f.state.posts).toBe(0);
});
it('rejects duplicate operations and manual reruns instead of accepting ambiguous success', async () => {
  const f = await fixture(); const evidence = await f.provider.inspect(f.request, f.signal);
  await f.provider.dispatch({ ...f.request, ...evidence }, f.signal);
  f.state.runs.push({ ...f.state.runs[0]!, id: 21 });
  await expect(f.provider.query(f.request, f.signal)).rejects.toThrow('Duplicate');
  f.state.runs.pop(); f.state.runs[0]!.run_attempt = 2;
  await expect(f.provider.query(f.request, f.signal)).rejects.toThrow('rerun');
});
it('cannot report long-lived canary health from a temporary smoke', async () => {
  const f = await fixture();
  await expect(f.provider.inspect({ ...f.request, target: { ...f.request.target, environment: 'canary' } }, f.signal)).rejects.toThrow('target');
});

it('checks expiry again after the final async token resolution before POST', async () => {
  const f = await fixture(); const evidence = await f.provider.inspect(f.request, f.signal);
  let calls = 0, now = 1000;
  const provider = new GitHubActionsDeliveryProvider({ ...f.options, now: () => now, token: async () => {
    calls++;
    // inspect: run/jobs/artifact/download token, then ref GET, then dispatch POST token.
    if (calls === 6) now = 3000;
    return 'test-service-token';
  } });
  expect((await provider.dispatch({ ...f.request, ...evidence }, f.signal)).status).toBe('unknown');
  expect(calls).toBe(6); expect(f.state.posts).toBe(0);
  expect((await provider.query(f.request, f.signal)).status).toBe('unknown');
});

it('rejects a candidate binding changed between inspection and dispatch', async () => {
  const f = await fixture(); const evidence = await f.provider.inspect(f.request, f.signal);
  let calls = 0;
  const provider = new GitHubActionsDeliveryProvider({ ...f.options, resolveCandidate: async () => {
    calls++;
    return { ...await f.options.resolveCandidate(), artifactId: calls === 1 ? 12 : 99 };
  } });
  await expect(provider.dispatch({ ...f.request, ...evidence }, f.signal)).rejects.toThrow('binding changed');
  expect(f.state.posts).toBe(0);
});
