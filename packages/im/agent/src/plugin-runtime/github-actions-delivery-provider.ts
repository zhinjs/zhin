import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import type { WorkroomDeliveryDispatch, WorkroomDeliveryObservation, WorkroomDeliveryProviderPort, WorkroomDeliveryReadiness, WorkroomDeliveryRequest } from './workroom-delivery-gateway.js';

/** Registered by the trusted control plane after a candidate build, never supplied by an Agent tool. */
export interface GitHubActionsCandidateBinding {
  readonly runId: number;
  readonly runAttempt: number;
  readonly artifactId: number;
  readonly artifactName: string;
}
export interface GitHubActionsDeliveryOptions {
  readonly repository: string;
  readonly repositoryId: number;
  readonly workflowId: number;
  readonly workflowPath: string;
  /** A protected, immutable tag; GitHub dispatch takes a branch/tag, not an arbitrary commit. */
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly actorIds: readonly number[];
  readonly requiredBuildJobs: readonly string[];
  readonly requiredSmokeJobs: readonly string[];
  readonly claimDirectory: string;
  readonly token: () => Promise<string>;
  readonly resolveCandidate: (request: WorkroomDeliveryRequest) => Promise<GitHubActionsCandidateBinding>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly maxArtifactBytes?: number;
}
interface Run {
  id: number; workflow_id: number; path: string; head_sha: string; run_attempt: number;
  event: string; display_title: string; status: string; conclusion: string | null;
  repository: { id: number }; head_repository: { id: number }; actor: { id: number };
}
interface Job { name: string; run_id: number; run_attempt: number; head_sha: string; status: string; conclusion: string | null }
interface Artifact {
  id: number; name: string; expired: boolean; digest: string; size_in_bytes: number;
  workflow_run: { id: number; repository_id: number; head_repository_id: number; head_sha: string };
}

/** Single-host durable dispatch claims. A claim is never deleted or retried, including on response loss. */
export class GitHubActionsDeliveryProvider implements WorkroomDeliveryProviderPort {
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly #options: GitHubActionsDeliveryOptions;
  constructor(options: GitHubActionsDeliveryOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository) || !/^[a-f0-9]{40}$/.test(options.workflowSha)
      || !options.workflowRef.startsWith('refs/tags/') || !options.workflowPath.startsWith('.github/workflows/')
      || !Number.isSafeInteger(options.repositoryId) || !Number.isSafeInteger(options.workflowId)
      || options.actorIds.length === 0 || options.requiredBuildJobs.length === 0 || options.requiredSmokeJobs.length === 0
      || new Set(options.requiredBuildJobs).size !== options.requiredBuildJobs.length
      || new Set(options.requiredSmokeJobs).size !== options.requiredSmokeJobs.length) throw new Error('Invalid trusted Actions profile');
    this.#options = { ...options, actorIds: [...options.actorIds], requiredBuildJobs: [...options.requiredBuildJobs], requiredSmokeJobs: [...options.requiredSmokeJobs] };
    const { repository, repositoryId, workflowId, workflowPath, workflowRef, workflowSha, actorIds, requiredBuildJobs, requiredSmokeJobs } = this.#options;
    this.provider = Object.freeze({ id: `github-actions:${repositoryId}:${workflowId}`, digest: digest({ repository, repositoryId, workflowId, workflowPath, workflowRef, workflowSha, actorIds, requiredBuildJobs, requiredSmokeJobs }) });
  }
  #now(): number { return (this.#options.now ?? Date.now)(); }
  #base(): string { return `https://api.github.com/repos/${this.#options.repository}`; }
  async #api<T>(path: string, signal: AbortSignal, body?: unknown, beforeSend?: () => void): Promise<T> {
    const token = await this.#options.token();
    signal.throwIfAborted();
    beforeSend?.();
    const response = await (this.#options.fetch ?? fetch)(this.#base() + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub Actions API returned ${response.status}`);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  /** Read-only connectivity check. This does not prove write permissions or a real candidate smoke. */
  async verifyConfiguration(signal: AbortSignal): Promise<void> {
    const repository = await this.#api<{ id: number }>('', signal);
    const workflow = await this.#api<{ id: number; path: string; state: string }>(`/actions/workflows/${this.#options.workflowId}`, signal);
    const ref = await this.#api<{ sha: string }>(`/commits/${encodeURIComponent(this.#options.workflowRef)}`, signal);
    if (repository.id !== this.#options.repositoryId || workflow.id !== this.#options.workflowId
      || workflow.path !== this.#options.workflowPath || workflow.state !== 'active' || ref.sha !== this.#options.workflowSha) throw new Error('Actions configuration not ready');
  }
  #target(request: WorkroomDeliveryRequest): void {
    if (request.target.repositoryId !== String(this.#options.repositoryId)
      || request.target.environment !== 'github-actions-smoke'
      || request.target.pipelineRef !== `${this.#options.workflowPath}@${this.#options.workflowSha}`
      || !/^[a-f0-9]{40}$/.test(request.target.headSha)
      || !/^sha256:[a-f0-9]{64}$/.test(request.target.artifactDigest)) throw new Error('Actions delivery target binding mismatch');
  }
  #run(run: Run, title: string): void {
    if (run.workflow_id !== this.#options.workflowId || run.path.split('@')[0] !== this.#options.workflowPath
      || run.head_sha !== this.#options.workflowSha || run.event !== 'workflow_dispatch'
      || run.repository.id !== this.#options.repositoryId || run.head_repository.id !== this.#options.repositoryId
      || !this.#options.actorIds.includes(run.actor.id) || run.display_title !== title
      || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('Untrusted Actions run provenance');
  }
  async #jobs(run: Run, required: readonly string[], signal: AbortSignal): Promise<WorkroomDeliveryReadiness['checks']> {
    const jobs: Job[] = [];
    for (let page = 1; page <= 20; page++) {
      const result = await this.#api<{ total_count: number; jobs: Job[] }>(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`, signal);
      jobs.push(...result.jobs);
      if (jobs.length >= result.total_count) break;
      if (page === 20 || result.jobs.length === 0) throw new Error('Actions job list incomplete');
    }
    return required.map(name => {
      const matches = jobs.filter(job => job.name === name);
      if (matches.length !== 1) throw new Error(`Missing or duplicate required Actions job: ${name}`);
      const job = matches[0]!;
      if (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha) throw new Error('Actions job provenance mismatch');
      return { id: `${run.id}:${run.run_attempt}:${name}`, status: job.status !== 'completed' ? 'pending' : job.conclusion === 'success' ? 'passed' : 'failed' };
    });
  }
  async #artifact(binding: GitHubActionsCandidateBinding, request: WorkroomDeliveryRequest, signal: AbortSignal): Promise<Artifact> {
    const artifact = await this.#api<Artifact>(`/actions/artifacts/${binding.artifactId}`, signal);
    if (artifact.id !== binding.artifactId || artifact.name !== binding.artifactName || artifact.expired
      || artifact.digest !== request.target.artifactDigest || artifact.workflow_run.id !== binding.runId
      || artifact.workflow_run.repository_id !== this.#options.repositoryId || artifact.workflow_run.head_repository_id !== this.#options.repositoryId
      || artifact.workflow_run.head_sha !== this.#options.workflowSha) throw new Error('Candidate artifact provenance or digest mismatch');
    const maximum = this.#options.maxArtifactBytes ?? 256 * 1024 * 1024;
    if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > maximum) throw new Error('Candidate artifact exceeds download budget');
    const transport = this.#options.fetch ?? fetch;
    const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    const redirect = await transport(this.#base() + `/actions/artifacts/${artifact.id}/zip`, { redirect: 'manual', signal: downloadSignal, headers: { Authorization: `Bearer ${await this.#options.token()}`, 'X-GitHub-Api-Version': '2022-11-28' } });
    if (redirect.status !== 302) throw new Error('Expected GitHub artifact download redirect');
    const location = new URL(redirect.headers.get('location') ?? '');
    if (location.protocol !== 'https:' || location.username || location.password) throw new Error('Invalid artifact download URL');
    // Signed storage URL receives no GitHub credentials; never follow a second redirect.
    const response = await transport(location, { redirect: 'error', signal: downloadSignal });
    if (!response.ok || !response.body) throw new Error('Artifact download failed');
    const hash = createHash('sha256'); let size = 0;
    const reader = response.body.getReader();
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > maximum) throw new Error('Artifact stream exceeds download budget'); hash.update(chunk.value); } }
    finally { await reader.cancel(); }
    if (`sha256:${hash.digest('hex')}` !== artifact.digest) throw new Error('Downloaded artifact digest mismatch');
    return artifact;
  }
  async inspect(request: WorkroomDeliveryRequest, signal: AbortSignal): Promise<WorkroomDeliveryReadiness> {
    this.#target(request);
    const binding = await this.#options.resolveCandidate(request);
    if (binding.artifactName !== `candidate-${request.target.headSha}-${binding.runAttempt}`) throw new Error('Artifact name does not bind the build attempt');
    const run = await this.#api<Run>(`/actions/runs/${binding.runId}`, signal);
    this.#run(run, `self-delivery:build:${request.target.headSha}`);
    if (run.id !== binding.runId || run.run_attempt !== binding.runAttempt || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Candidate build attempt is stale or unsuccessful');
    const checks = await this.#jobs(run, this.#options.requiredBuildJobs, signal);
    const artifact = await this.#artifact(binding, request, signal);
    const evidence = { runId: run.id, runAttempt: run.run_attempt, workflowSha: run.head_sha, candidateHash: request.candidateHash, target: request.target, checks, artifactId: artifact.id, artifactDigest: artifact.digest };
    const now = this.#now();
    return { target: request.target, candidateHash: request.candidateHash, targetDigest: request.targetDigest, evidenceRef: `github-actions:${run.id}:${run.run_attempt}:${artifact.id}`, evidenceDigest: digest(evidence), checks, observedAt: now, expiresAt: now + 60_000 };
  }
  #key(request: WorkroomDeliveryRequest): string { return digest({ projectId: request.projectId, idempotencyKey: request.idempotencyKey }).replace(/[^a-zA-Z0-9]/g, ''); }
  #claimValue(request: WorkroomDeliveryRequest): string { return JSON.stringify({ provider: this.provider, projectId: request.projectId, effectId: request.effectId, intentDigest: request.intentDigest, candidateHash: request.candidateHash, target: request.target, idempotencyKey: request.idempotencyKey }); }
  async #claim(request: WorkroomDeliveryRequest): Promise<boolean> {
    await mkdir(this.#options.claimDirectory, { recursive: true, mode: 0o700 });
    const path = join(this.#options.claimDirectory, this.#key(request) + '.json');
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await readFile(path, 'utf8') !== this.#claimValue(request)) throw new Error('Actions claim collision or incomplete durable claim', { cause: error });
      return false;
    }
    try { await handle.writeFile(this.#claimValue(request)); await handle.sync(); } finally { await handle.close(); }
    if (process.platform !== 'win32') {
      const directory = await open(this.#options.claimDirectory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
  async dispatch(request: WorkroomDeliveryDispatch & { evidenceRef: string; evidenceDigest: string }, signal: AbortSignal): Promise<WorkroomDeliveryObservation> {
    this.#target(request);
    // An existing claim always goes directly to read-only reconciliation, even after authorization expires.
    try {
      const existing = await readFile(join(this.#options.claimDirectory, this.#key(request) + '.json'), 'utf8');
      if (existing !== this.#claimValue(request)) throw new Error('Actions claim collision');
      return this.query(request, signal);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const evidence = await this.inspect(request, signal);
    if (evidence.evidenceRef !== request.evidenceRef || evidence.evidenceDigest !== request.evidenceDigest || evidence.checks.some(item => item.status !== 'passed') || request.authorizationExpiresAt <= this.#now()) throw new Error('Actions dispatch evidence or authorization changed');
    const ref = await this.#api<{ sha: string }>(`/commits/${encodeURIComponent(this.#options.workflowRef)}`, signal);
    if (ref.sha !== this.#options.workflowSha) throw new Error('Trusted workflow ref moved');
    if (!await this.#claim(request)) return this.query(request, signal);
    const binding = await this.#options.resolveCandidate(request);
    if (`github-actions:${binding.runId}:${binding.runAttempt}:${binding.artifactId}` !== evidence.evidenceRef
      || binding.artifactName !== `candidate-${request.target.headSha}-${binding.runAttempt}`) throw new Error('Candidate artifact binding changed before dispatch');
    // Any error after the durable claim is intentionally query-only. Dispatch has no native idempotency.
    try {
      await this.#api(`/actions/workflows/${this.#options.workflowId}/dispatches`, signal, { ref: this.#options.workflowRef, inputs: { mode: 'smoke', candidate_sha: request.target.headSha, operation_key: this.#key(request), artifact_id: String(binding.artifactId), artifact_digest: request.target.artifactDigest } }, () => {
        if (request.authorizationExpiresAt <= this.#now()) throw new Error('Actions authorization expired before dispatch');
      });
    } catch { return this.#observation(request, undefined, 'unknown', 'unknown'); }
    return this.query(request, signal);
  }
  async query(request: WorkroomDeliveryDispatch, signal: AbortSignal): Promise<WorkroomDeliveryObservation> {
    this.#target(request);
    const claim = await readFile(join(this.#options.claimDirectory, this.#key(request) + '.json'), 'utf8');
    if (claim !== this.#claimValue(request)) throw new Error('Actions query requires the original durable claim');
    const title = `self-delivery:smoke:${this.#key(request)}:${request.target.headSha}:${request.target.artifactDigest}`;
    const matches: Run[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await this.#api<{ total_count: number; workflow_runs: Run[] }>(`/actions/workflows/${this.#options.workflowId}/runs?event=workflow_dispatch&head_sha=${this.#options.workflowSha}&per_page=100&page=${page}`, signal);
      matches.push(...result.workflow_runs.filter(run => run.display_title === title));
      if (page * 100 >= result.total_count) break;
      if (page === 10) throw new Error('Actions reconciliation window incomplete; operator investigation required');
    }
    if (matches.length > 1) throw new Error('Duplicate Actions operation runs; operator investigation required');
    const run = matches[0];
    if (!run) return this.#observation(request, undefined, 'unknown', 'unknown');
    this.#run(run, title);
    // A manual rerun is a separate execution and is never silently accepted under the original dispatch.
    if (run.run_attempt !== 1) throw new Error('Actions operation was rerun; fresh authorization required');
    if (run.status !== 'completed') return this.#observation(request, run, 'running', 'pending');
    const checks = await this.#jobs(run, this.#options.requiredSmokeJobs, signal);
    const passed = run.conclusion === 'success' && checks.every(check => check.status === 'passed');
    return this.#observation(request, run, passed ? 'succeeded' : 'failed', passed ? 'passed' : 'failed');
  }
  #observation(request: WorkroomDeliveryDispatch, run: Run | undefined, status: WorkroomDeliveryObservation['status'], health: WorkroomDeliveryObservation['health']): WorkroomDeliveryObservation {
    const ref = run ? `https://github.com/${this.#options.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}` : `github-actions-operation:${this.#key(request)}`;
    return { effectId: request.effectId, intentDigest: request.intentDigest, idempotencyKey: request.idempotencyKey, target: request.target, candidateHash: request.candidateHash, deploymentRef: ref, receiptRef: ref, status, health, observedAt: this.#now(), authenticatedBy: this.provider.id };
  }
}
