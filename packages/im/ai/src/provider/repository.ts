import type { JsonValue } from '../decision/types.js';
import type { ProviderGraph } from './types.js';

/** Encrypted payload only. Plaintext material never enters the public graph. */
export interface ProviderCredentialRecord {
  readonly rootId: string;
  readonly accountId: string;
  readonly incarnation: string;
  readonly revision: number;
  readonly authContractVersion: string;
  readonly formatVersion: number;
  readonly payload: JsonValue;
}
export interface ProviderCredentialWrite {
  readonly accountId: string;
  /** Zero means no prior record. */
  readonly expectedRevision: number;
  readonly expectedIncarnation: string;
  readonly expectedAuthContractVersion?: string;
  /** Null is allowed only in the graph transaction that removes this account.
   * Disconnect retains a versioned encrypted tombstone to reject late refreshes. */
  readonly record: ProviderCredentialRecord | null;
}
export interface ProviderMutationReceipt {
  readonly rootId: string;
  readonly mutationId: string;
  readonly fingerprint: string;
  readonly graphRevision: number;
  /** Non-secret mappings/results required for idempotent response recovery. */
  readonly result: JsonValue;
}
export interface CommitProviderGraphInput {
  readonly rootId: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
  readonly fingerprint: string;
  readonly graph: ProviderGraph;
  readonly credentials?: readonly ProviderCredentialWrite[];
  readonly result: JsonValue;
}
export type ProviderMutationResult =
  | Readonly<{ status: 'committed'; receipt: ProviderMutationReceipt; replayed: boolean }>
  | Readonly<{ status: 'conflict'; reason: 'revision' | 'mutation-content' | 'credential' }>
  | Readonly<{ status: 'not-committed' }>
  | Readonly<{ status: 'commit-unknown' }>;
export type ProviderCredentialCommitResult = Readonly<{ status: 'committed' | 'conflict' | 'not-committed' | 'commit-unknown' }>;
/** Host implementation must transact graph, receipt and credential writes together. */
export interface ProviderRepository {
  readGraph(input: Readonly<{ rootId: string }>): Promise<ProviderGraph | undefined>;
  readMutation(input: Readonly<{ rootId: string; mutationId: string }>): Promise<ProviderMutationReceipt | undefined>;
  commit(input: CommitProviderGraphInput): Promise<ProviderMutationResult>;
  readCredential(input: Readonly<{ rootId: string; accountId: string }>): Promise<ProviderCredentialRecord | undefined>;
  commitCredential(input: Readonly<{ rootId: string; write: ProviderCredentialWrite }>): Promise<ProviderCredentialCommitResult>;
}
