import { digestCanonicalWorkroomValue as digest, deepFreezeWorkroomValue as freeze } from './canonical-value.js';
import type {
  GitWorkspaceCredential, GitWorkspaceTransportPort, GitPushTransportInput,
  GitPullRequestTransportInput, GitPushReceipt, GitPullRequestReceipt,
} from './git-workspace-gateway.js';

export interface GitHubWorkspaceTransportOptions {
  /** Trusted host configuration, never a URL supplied by a task or tool. */
  readonly apiBaseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** A failed/ambiguous write must be reconciled by reads; this transport never retries writes. */
export class GitHubWorkspaceHttpError extends Error {
  constructor(readonly status: number) {
    super(`GitHub Workspace HTTP ${status}; reconcile before retrying a write`);
    this.name = 'GitHubWorkspaceHttpError';
  }
}

type JsonObject = Record<string, unknown>;

/**
 * Publishes refs to commits already present on GitHub; does not upload local Git objects.
 * Instantiate per generation and place behind GitWorkspaceGateway, never expose it as a tool.
 * REST does not provide compare-and-swap PR creation: verify returned refs/SHA and fail closed.
 */
export class GitHubWorkspaceTransport implements GitWorkspaceTransportPort {
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly #base: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: GitHubWorkspaceTransportOptions = {}) {
    const url = new URL(options.apiBaseUrl ?? 'https://api.github.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('GitHub Workspace API base must be a trusted HTTPS URL');
    }
    this.#base = url.href.replace(/\/$/u, '');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.provider = freeze({ id: 'github', digest: digest({ transport: 'github-rest-workspace-v1', apiBaseUrl: this.#base }) });
  }

  async push(input: GitPushTransportInput, credential: GitWorkspaceCredential, signal: AbortSignal): Promise<GitPushReceipt> {
    const path = repositoryPath(input.repositoryId);
    refName(input.ref);
    sha(input.headSha);
    sha(input.baseSha);
    if (input.force !== false) throw new Error('Force push is forbidden');
    await this.#verifyDiff(input, credential, signal);
    const current = await this.#readRef(input.repositoryId, input.ref, credential, signal);
    if (current && object(current.object).sha === input.headSha) return this.#pushReceipt(input, current);
    const response = current
      ? await this.#request(`${path}/git/refs/${encodeRef(input.ref)}`, credential, signal, 'PATCH', { sha: input.headSha, force: false })
      : await this.#request(`${path}/git/refs`, credential, signal, 'POST', { ref: input.ref, sha: input.headSha });
    return this.#pushReceipt(input, object(response));
  }

  async queryPush(input: GitPushTransportInput, credential: GitWorkspaceCredential, signal: AbortSignal): Promise<GitPushReceipt | undefined> {
    sha(input.headSha);
    const current = await this.#readRef(input.repositoryId, input.ref, credential, signal);
    // Absence or a moved ref does not prove that an earlier write did not commit.
    if (!current || object(current.object).sha !== input.headSha) return undefined;
    // Recovery may run after the durable attempt but before execution ever verified the diff.
    await this.#verifyDiff(input, credential, signal);
    return this.#pushReceipt(input, current);
  }

  async openPullRequest(input: GitPullRequestTransportInput, credential: GitWorkspaceCredential, signal: AbortSignal): Promise<GitPullRequestReceipt> {
    const existing = await this.queryPullRequest(input, credential, signal);
    if (existing) return existing;
    await this.#verifyDiff(input, credential, signal);
    const head = await this.#readRef(input.repositoryId, input.headRef, credential, signal);
    if (!head || object(head.object).sha !== input.headSha) throw new Error('GitHub PR head SHA drift before creation');
    const response = await this.#request(`${repositoryPath(input.repositoryId)}/pulls`, credential, signal, 'POST', {
      title: `Workroom: ${refName(input.headRef)}`,
      body: marker(input),
      head: refName(input.headRef),
      base: refName(input.baseRef),
      draft: true,
    });
    return this.#pullRequestReceipt(input, object(response));
  }

  async queryPullRequest(input: GitPullRequestTransportInput, credential: GitWorkspaceCredential, signal: AbortSignal): Promise<GitPullRequestReceipt | undefined> {
    const path = repositoryPath(input.repositoryId);
    sha(input.headSha);
    const owner = input.repositoryId.slice('github:'.length).split('/')[0];
    const search = new URLSearchParams({ state: 'all', head: `${owner}:${refName(input.headRef)}`, base: refName(input.baseRef), per_page: '100' });
    // Explicit page traversal rather than following provider-supplied URLs with credentials.
    for (let page = 1; page <= 100; page += 1) {
      search.set('page', String(page));
      const rows = await this.#request(`${path}/pulls?${search}`, credential, signal);
      if (!Array.isArray(rows)) throw new Error('GitHub PR list response is invalid');
      for (const raw of rows) {
        const row = object(raw);
        if (typeof row.body === 'string' && row.body.includes(marker(input))) {
          const receipt = this.#pullRequestReceipt(input, row);
          await this.#verifyDiff(input, credential, signal);
          return receipt;
        }
        // Another operation owns this branch pair. Do not silently adopt or duplicate it.
        if (object(row.head).ref === refName(input.headRef) && object(row.base).ref === refName(input.baseRef)) {
          throw new Error('GitHub PR already exists with a different operation binding');
        }
      }
      if (rows.length < 100) return undefined;
    }
    throw new Error('GitHub PR lookup pagination limit reached; outcome remains unknown');
  }

  async cancel(_input: Parameters<GitWorkspaceTransportPort['cancel']>[0], _credential: GitWorkspaceCredential, signal: AbortSignal): Promise<Awaited<ReturnType<GitWorkspaceTransportPort['cancel']>>> {
    signal.throwIfAborted();
    // Closing a PR or deleting a branch is compensation, not cancellation of an HTTP write.
    throw new Error('GitHub synchronous writes cannot be cancelled; reconcile the original operation');
  }

  async #verifyDiff(input: Readonly<{ repositoryId: string; baseSha: string; headSha: string; pathScopes: readonly string[] }>, credential: GitWorkspaceCredential, signal: AbortSignal): Promise<void> {
    const path = repositoryPath(input.repositoryId);
    sha(input.baseSha);
    sha(input.headSha);
    // Read the actual immutable Git diff; the worker-supplied changedPaths is not evidence.
    const comparison = object(await this.#request(`${path}/compare/${input.baseSha}...${input.headSha}`, credential, signal));
    if (comparison.status !== 'ahead' || object(comparison.base_commit).sha !== input.baseSha
      || object(comparison.merge_base_commit).sha !== input.baseSha) {
      throw new Error('GitHub candidate must descend from the exact workspace base SHA');
    }
    if (!Array.isArray(comparison.files) || comparison.files.length === 0 || comparison.files.length >= 300) {
      // GitHub caps compare files at 300, even with pagination. Never authorize a truncated diff.
      throw new Error('GitHub candidate diff is empty or may be truncated');
    }
    for (const raw of comparison.files) {
      const file = object(raw);
      assertPathScope(file.filename, input.pathScopes);
      if (file.status === 'renamed') assertPathScope(file.previous_filename, input.pathScopes);
    }
  }

  #pushReceipt(input: GitPushTransportInput, response: JsonObject): GitPushReceipt {
    if (response.ref !== input.ref || object(response.object).sha !== input.headSha || object(response.object).type !== 'commit') {
      throw new Error('GitHub push receipt SHA or ref binding drift');
    }
    return freeze({ provider: this.provider, repositoryId: input.repositoryId, ref: input.ref, headSha: input.headSha,
      externalReceiptRef: `${this.#base}${repositoryPath(input.repositoryId)}/git/ref/${encodeRef(input.ref)}`,
      externalReceiptDigest: digest({ operationId: input.operationId, idempotencyKey: input.idempotencyKey, repositoryId: input.repositoryId, response }),
    });
  }

  #pullRequestReceipt(input: GitPullRequestTransportInput, response: JsonObject): GitPullRequestReceipt {
    const head = object(response.head);
    const base = object(response.base);
    const repo = input.repositoryId.slice('github:'.length);
    if (head.sha !== input.headSha || head.ref !== refName(input.headRef) || base.ref !== refName(input.baseRef)
      || String(object(head.repo).full_name).toLowerCase() !== repo || String(object(base.repo).full_name).toLowerCase() !== repo
      || typeof response.body !== 'string' || !response.body.includes(marker(input))
      || !Number.isSafeInteger(response.number) || Number(response.number) < 1) {
      throw new Error('GitHub PR receipt repository, SHA, ref, or operation binding drift');
    }
    return freeze({ provider: this.provider, repositoryId: input.repositoryId,
      prRef: `${this.#base}${repositoryPath(input.repositoryId)}/pulls/${response.number}`,
      headRef: input.headRef, baseRef: input.baseRef, prHeadSha: input.headSha,
      externalReceiptDigest: digest({ operationId: input.operationId, idempotencyKey: input.idempotencyKey, response }),
    });
  }

  async #readRef(repositoryId: string, ref: string, credential: GitWorkspaceCredential, signal: AbortSignal): Promise<JsonObject | undefined> {
    const response = await this.#request(`${repositoryPath(repositoryId)}/git/ref/${encodeRef(ref)}`, credential, signal, 'GET', undefined, true);
    if (response === undefined) return undefined;
    const result = object(response);
    if (result.ref !== ref || object(result.object).type !== 'commit') throw new Error('GitHub ref response binding drift');
    return result;
  }

  async #request(path: string, credential: GitWorkspaceCredential, signal: AbortSignal, method = 'GET', body?: JsonObject, allowMissing = false): Promise<unknown> {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}${path}`, {
        method, signal, redirect: 'error', headers: {
          accept: 'application/vnd.github+json', authorization: `Bearer ${credential.secret}`,
          'X-GitHub-Api-Version': '2022-11-28', 'content-type': 'application/json',
        }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // Do not leak fetch error bodies, URLs or credential-bearing host diagnostics.
      throw new Error('GitHub Workspace request interrupted; reconcile before retrying a write');
    }
    signal.throwIfAborted();
    if (allowMissing && response.status === 404) return undefined;
    if (!response.ok) throw new GitHubWorkspaceHttpError(response.status);
    try { return await response.json(); } catch { throw new Error('GitHub Workspace response is invalid JSON; reconcile before retrying a write'); }
  }
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub Workspace response object is invalid');
  return value as JsonObject;
}
function repositoryPath(repositoryId: string): string {
  if (!/^github:[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(repositoryId)) throw new Error('GitHub repository ID is invalid');
  if (repositoryId.slice('github:'.length).split('/').some(part => part === '.' || part === '..')) throw new Error('GitHub repository ID is invalid');
  return `/repos/${repositoryId.slice('github:'.length).split('/').map(encodeURIComponent).join('/')}`;
}
function refName(ref: string): string {
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(ref) || ref.includes('..') || ref.includes('//') || ref.endsWith('/')) throw new Error('GitHub branch ref is invalid');
  return ref.slice('refs/heads/'.length);
}
function encodeRef(ref: string): string { return `heads/${refName(ref).split('/').map(encodeURIComponent).join('/')}`; }
function sha(value: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) throw new Error('GitHub exact commit SHA is invalid');
}
function marker(input: GitPullRequestTransportInput): string {
  return `<!-- zhin-workroom:${digest(input)} -->`;
}
function assertPathScope(value: unknown, scopes: readonly string[]): void {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')
    || value.split('/').some(part => !part || part === '.' || part === '..')
    || !scopes.some(scope => value === scope || (scope.endsWith('/') && value.startsWith(scope)))) {
    throw new Error('GitHub actual changed path is outside the workspace lease');
  }
}
