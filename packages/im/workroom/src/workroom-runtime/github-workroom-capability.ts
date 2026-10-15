import { canonicalWorkroomJson, digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import { createGitWorkspaceLease, type GitWorkspaceCredentialPort } from '../workroom/git-workspace-gateway.js';
import { GitHubWorkspaceTransport, type GitHubWorkspaceTransportOptions } from '../workroom/github-workspace-transport.js';
import type { WorkroomGitHubCapabilityPort } from './workroom-effect-production.js';

export interface GitHubWorkroomCapabilityOptions extends GitHubWorkspaceTransportOptions {
  readonly credentials: GitWorkspaceCredentialPort;
  /** Explicit logical identity when it differs from the transport provider identity. */
  readonly binding?: Readonly<{ ref: string; digest: string }>;
  readonly now?: () => number;
}

/** Register the returned capability as a generation Resource; no process-global credentials/state. */
export function createGitHubWorkroomCapability(options: GitHubWorkroomCapabilityOptions): WorkroomGitHubCapabilityPort {
  const transport = new GitHubWorkspaceTransport(options);
  const now = options.now ?? Date.now;
  const binding = Object.freeze(options.binding
    ? { ref: options.binding.ref, digest: options.binding.digest }
    : { ref: transport.provider.id, digest: transport.provider.digest });
  if (typeof binding.ref !== 'string' || !binding.ref.trim() || binding.ref !== binding.ref.trim()
    || !/^sha256:[a-f0-9]{64}$/u.test(binding.digest)) throw new Error('GitHub capability binding is invalid');
  return Object.freeze({
    binding,
    provider: transport.provider,
    credentials: options.credentials,
    transport,
    async reconcile({ generation, state, lease }, signal) {
      signal.throwIfAborted();
      const canonical = createGitWorkspaceLease(lease);
      const operation = state.intent.operation;
      if (canonicalWorkroomJson(state.intent.capability) !== canonicalWorkroomJson(binding)) {
        throw new Error('GitHub reconciliation capability binding drift');
      }
      if (canonicalWorkroomJson(canonical) !== canonicalWorkroomJson(lease)
        || !state.attempt || !state.authorization || !Number.isSafeInteger(generation) || generation < 1
        || state.intent.projectId !== lease.projectId || state.intent.runId !== lease.runId
        || state.intent.taskKey !== lease.taskKey || state.intent.taskRevision !== lease.taskRevision
        || state.intent.target.ref !== lease.leaseRef || state.intent.target.digest !== lease.digest) {
        throw new Error('GitHub reconciliation requires the exact authorized workspace lease and attempt');
      }
      if (operation.kind !== 'git_push' && operation.kind !== 'git_open_pr' && operation.kind !== 'git_cancel_remote') {
        throw new Error('GitHub reconciliation operation is unsupported');
      }
      if (operation.parameters.repositoryId !== lease.repository.id
        || (operation.kind === 'git_push' && operation.parameters.ref !== lease.attemptBranch)
        || (operation.kind === 'git_open_pr' && (operation.parameters.headRef !== lease.attemptBranch
          || operation.parameters.baseRef !== lease.targetRef || lease.mode !== 'pull_request'))) {
        throw new Error('GitHub reconciliation operation is outside the workspace lease');
      }
      // Querying after an expired lease is safe and required for recovery. Only fresh credentials are used.
      const credential = await options.credentials.resolve({ generation, leaseDigest: lease.digest,
        repositoryId: lease.repository.id, bindingRef: lease.repository.bindingRef,
        bindingDigest: lease.repository.bindingDigest, operation: operation.kind }, signal);
      signal.throwIfAborted();
      if (!credential.credentialId || !credential.secret || !Number.isSafeInteger(credential.expiresAt)
        || credential.expiresAt <= now()) throw new Error('GitHub reconciliation credential is invalid or expired');
      const operationId = state.attempt.operationId;
      const shared = { operationId, repositoryId: lease.repository.id };
      let remoteRef: string | undefined;
      let remoteDigest: string | undefined;
      if (operation.kind === 'git_push') {
        const receipt = await transport.queryPush({ ...shared, ref: lease.attemptBranch,
          headSha: operation.parameters.headSha, force: false, baseSha: lease.baseSha, pathScopes: lease.pathScopes,
          idempotencyKey: `git-push:${lease.digest}:${operationId}`,
        }, credential, signal);
        remoteRef = receipt?.externalReceiptRef;
        remoteDigest = receipt?.externalReceiptDigest;
      } else if (operation.kind === 'git_open_pr') {
        const receipt = await transport.queryPullRequest({ ...shared, headRef: lease.attemptBranch,
          baseRef: lease.targetRef, headSha: operation.parameters.headSha, baseSha: lease.baseSha, pathScopes: lease.pathScopes,
          idempotencyKey: `git-pr:${lease.digest}:${operationId}`,
        }, credential, signal);
        remoteRef = receipt?.prRef;
        remoteDigest = receipt?.externalReceiptDigest;
      }
      const observedAt = now();
      return Object.freeze({ outcome: remoteRef ? 'committed' : 'outcome_unknown', provider: transport.provider,
        remoteRef: remoteRef ?? `github-observation:${digest({ operationId, repositoryId: lease.repository.id })}`,
        remoteDigest: remoteDigest ?? digest({ operationId, observedAt, outcome: 'outcome_unknown' }),
        observedAt, authenticatedBy: credential.credentialId,
      });
    },
  } satisfies WorkroomGitHubCapabilityPort);
}
