import { GitHubExactMergeInspector, WorkroomExactMergeGateway } from '../../src/plugin-runtime/github-exact-merge-gateway.js';
import { createWorkroomEffectIntent, MemoryWorkroomEffectJournal, WorkroomEffectLedger } from '../../src/workroom/effect-ledger.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

async function fixture() {
  const protection = { enforce_admins: { enabled: true }, required_status_checks: { strict: true } };
  const checks = { total_count: 1, check_runs: [{ name: 'test', conclusion: 'success' }] };
  const pull = { number: 23, state: 'open', draft: false, merged: false, head: { sha: 'a'.repeat(40), repo: { id: 42 } }, base: { ref: 'main', sha: 'b'.repeat(40), repo: { id: 42 } } };
  const transport = vi.fn<typeof fetch>(async (url, options) => {
    expect(options?.method).toBe('GET');
    return Response.json(String(url).includes('/pulls/') ? pull : String(url).includes('/protection') ? protection : checks);
  });
  const inspector = new GitHubExactMergeInspector({ repository: 'zhinjs/zhin', repositoryId: 42, token: async () => 'fixture-token', fetch: transport });
  const parameters = { repositoryId: '42', pullNumber: 23, headSha: pull.head.sha, baseRef: 'main', baseSha: pull.base.sha, protectionDigest: digest(protection), checksDigest: digest(checks) };
  const input = { projectId: 'project', runId: 'run', taskKey: 'merge', taskRevision: 1, candidateHash: digest('candidate'), capability: { ref: inspector.provider.id, digest: inspector.provider.digest }, operation: { kind: 'git_merge_pr' as const, parameters }, target: { ref: 'github-pr:23', digest: digest(parameters) }, preconditions: [{ ref: 'ci', digest: digest(checks) }], risk: { assessmentRef: 'risk', assessmentDigest: digest('risk'), tier: 'high' as const }, reversibility: { kind: 'irreversible' as const }, idempotencyKey: 'merge-23', createdAt: 10 };
  const ledger = new WorkroomEffectLedger(new MemoryWorkroomEffectJournal());
  const intent = createWorkroomEffectIntent(input);
  await ledger.recordIntent('project', intent);
  const state = await ledger.read('project', intent.id);
  const fallback = { prepare: vi.fn(), execute: vi.fn(), reconcile: vi.fn() };
  const gateway = new WorkroomExactMergeGateway({ resolveInspector: () => inspector, fallback });
  return { inspector, gateway, state, input, pull, fallback, transport, signal: new AbortController().signal };
}
it('persists exact head/base/protection/check bindings in the existing typed Effect', async () => {
  const f = await fixture();
  expect(f.state.intent.operation).toEqual(f.input.operation);
  expect(() => createWorkroomEffectIntent({ ...f.input, operation: { ...f.input.operation, parameters: { ...f.input.operation.parameters, baseSha: 'main' } } })).toThrow('baseSha');
  expect(() => createWorkroomEffectIntent({ ...f.input, operation: { ...f.input.operation, parameters: { ...f.input.operation.parameters, pullNumber: 0 } } })).toThrow('pullNumber');
});
it('fails closed even with matching protection and checks because GitHub has no exact-base CAS', async () => {
  const f = await fixture();
  expect((await f.inspector.inspect(f.input.operation.parameters, f.signal)).blockers).toEqual(['github_exact_base_cas_unavailable']);
  for (const method of ['prepare', 'execute', 'reconcile'] as const) {
    await expect(f.gateway[method](f.state, f.signal)).rejects.toThrow('github_exact_base_cas_unavailable');
  }
  expect(f.fallback.execute).not.toHaveBeenCalled();
  expect(f.transport.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
});
it('reports stale head/base and never treats an external merge as this Effect success', async () => {
  const f = await fixture(); f.pull.base.sha = 'c'.repeat(40); f.pull.merged = true;
  const inspection = await f.inspector.inspect(f.input.operation.parameters, f.signal);
  expect(inspection.blockers).toContain('pull_head_or_base_changed');
  expect(inspection.blockers).toContain('pull_not_mergeable');
  await expect(f.gateway.reconcile(f.state, f.signal)).rejects.toThrow('Exact merge blocked');
});
