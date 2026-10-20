import { createToken } from '@zhin.js/plugin-runtime';
import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import type { WorkroomEffectState, WorkroomEffectGatewayReceipt, WorkroomEffectIntentInput } from '../workroom/effect-ledger.js';
import type { WorkroomEffectGatewayPort } from './workroom-effect-runtime.js';

export type GitHubExactMergeTarget = Extract<WorkroomEffectIntentInput['operation'], { kind: 'git_merge_pr' }>['parameters'];
export interface GitHubExactMergeInspection {
  readonly target: GitHubExactMergeTarget;
  readonly blockers: readonly string[];
  readonly observedAt: number;
}
export interface GitHubExactMergeInspectorPort {
  readonly provider: Readonly<{ id: string; digest: string }>;
  inspect(target: GitHubExactMergeTarget, signal: AbortSignal): Promise<GitHubExactMergeInspection>;
}
export const workroomExactMergeInspectorToken = createToken<GitHubExactMergeInspectorPort>(
  'zhin.agent.workroom-exact-merge-inspector', 'Read-only exact PR merge prerequisite inspector; no base CAS available',
);

/**
 * GitHub REST merge accepts a head SHA CAS, but no expected base SHA.
 * https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
 * A read-before-write check cannot implement our exact-base authorization contract.
 * This adapter intentionally exposes no PUT transport and always returns a blocker.
 */
export class GitHubExactMergeInspector implements GitHubExactMergeInspectorPort {
  readonly provider: Readonly<{ id: string; digest: string }>;
  constructor(readonly options: Readonly<{ repository: string; repositoryId: number; token: () => Promise<string>; fetch?: typeof fetch; now?: () => number }>) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository) || !Number.isSafeInteger(options.repositoryId)) throw new Error('Invalid exact merge repository');
    this.provider = Object.freeze({ id: `github-exact-merge:${options.repositoryId}`, digest: digest({ repository: options.repository, repositoryId: options.repositoryId, strategy: 'head-and-base-cas-required-v1' }) });
  }
  async #get<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(`https://api.github.com/repos/${this.options.repository}${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${await this.options.token()}`, 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw new Error(`GitHub exact merge inspection returned ${response.status}`);
    return await response.json() as T;
  }
  async inspect(target: GitHubExactMergeTarget, signal: AbortSignal): Promise<GitHubExactMergeInspection> {
    if (target.repositoryId !== String(this.options.repositoryId) || !Number.isSafeInteger(target.pullNumber) || target.pullNumber < 1) throw new Error('Exact merge repository or PR binding mismatch');
    const pull = await this.#get<{ number: number; state: string; draft: boolean; merged: boolean; head: { sha: string; repo: { id: number } }; base: { ref: string; sha: string; repo: { id: number } } }>(`/pulls/${target.pullNumber}`, signal);
    const protection = await this.#get<Record<string, unknown>>(`/branches/${encodeURIComponent(target.baseRef)}/protection`, signal);
    const checks = await this.#get<{ total_count: number; check_runs: unknown[] }>(`/commits/${target.headSha}/check-runs?per_page=100`, signal);
    const blockers = ['github_exact_base_cas_unavailable'];
    if (pull.number !== target.pullNumber || pull.head.repo.id !== this.options.repositoryId || pull.base.repo.id !== this.options.repositoryId) blockers.push('pull_repository_mismatch');
    if (pull.state !== 'open' || pull.draft || pull.merged) blockers.push('pull_not_mergeable');
    if (pull.head.sha !== target.headSha || pull.base.ref !== target.baseRef || pull.base.sha !== target.baseSha) blockers.push('pull_head_or_base_changed');
    if (digest(protection) !== target.protectionDigest) blockers.push('branch_protection_changed');
    if (checks.total_count > checks.check_runs.length) blockers.push('required_checks_snapshot_incomplete');
    if (digest(checks) !== target.checksDigest) blockers.push('required_checks_snapshot_changed');
    return { target, blockers, observedAt: (this.options.now ?? Date.now)() };
  }
}

/** Routes through the existing Effect journal/blocker system; never silently weakens an exact-base Gate. */
export class WorkroomExactMergeGateway implements WorkroomEffectGatewayPort {
  constructor(readonly options: Readonly<{ resolveInspector: () => GitHubExactMergeInspectorPort | undefined; fallback: WorkroomEffectGatewayPort }>) {}
  async #blocked(state: WorkroomEffectState, signal: AbortSignal): Promise<never> {
    signal.throwIfAborted();
    if (state.intent.operation.kind !== 'git_merge_pr') throw new Error('Expected git_merge_pr');
    const inspector = this.options.resolveInspector();
    if (!inspector || inspector.provider.id !== state.intent.capability.ref || inspector.provider.digest !== state.intent.capability.digest) throw new Error('Exact merge capability unavailable or changed');
    const result = await inspector.inspect(state.intent.operation.parameters, signal);
    if (digest(result.target) !== digest(state.intent.operation.parameters)) throw new Error('Exact merge inspection target drift');
    // Even a misconfigured inspector cannot turn the known platform limitation into permission to write.
    throw new Error(`Exact merge blocked: ${[...new Set(['github_exact_base_cas_unavailable', ...result.blockers])].join(', ')}`);
  }
  async prepare(state: WorkroomEffectState, signal: AbortSignal): Promise<void> {
    if (state.intent.operation.kind === 'git_merge_pr') return this.#blocked(state, signal);
    await this.options.fallback.prepare?.(state, signal);
  }
  execute(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    return state.intent.operation.kind === 'git_merge_pr' ? this.#blocked(state, signal) : this.options.fallback.execute(state, signal);
  }
  reconcile(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    // An externally merged PR cannot be attributed to an operation this adapter never submitted.
    return state.intent.operation.kind === 'git_merge_pr' ? this.#blocked(state, signal) : this.options.fallback.reconcile(state, signal);
  }
}
