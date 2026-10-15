import type {
  GovernedDisclosureManifestRequest,
  MaterializedDisclosureManifest,
} from './disclosure-manifest.js';
import type { DataGovernanceBlockerKind } from './governance-authority-repository.js';

/** Domain port shared by model, Projection, Evidence and A2A adapters. */
export interface WorkroomDisclosureManifestAuthorityPort {
  materialize(
    request: GovernedDisclosureManifestRequest,
    signal: AbortSignal,
  ): Promise<MaterializedDisclosureManifest | null>;
  revalidate(
    input: GovernedDisclosureRevalidationInput,
    signal: AbortSignal,
  ): Promise<GovernedDisclosureRevalidationResult>;
  prepareProjection(
    input: GovernedProjectionDisclosureInput,
    signal: AbortSignal,
  ): Promise<GovernedProjectionDisclosureResult>;
}

export interface GovernedProjectionDisclosureInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly sinkRuleId: string;
  readonly body: string;
  readonly sourceEventIds: readonly string[];
}

export type GovernedProjectionDisclosureResult =
  | Readonly<{
      status: 'ready';
      request: GovernedDisclosureManifestRequest;
      manifest: MaterializedDisclosureManifest;
    }>
  | Readonly<{ status: 'blocked'; reason: GovernedDisclosureBlockReason }>;

export interface GovernedDisclosureRevalidationInput {
  readonly request: GovernedDisclosureManifestRequest;
  readonly manifest: MaterializedDisclosureManifest;
}

export type GovernedDisclosureBlockReason = DataGovernanceBlockerKind;

export type GovernedDisclosureRevalidationResult =
  | Readonly<{
      status: 'ready';
      manifest: MaterializedDisclosureManifest;
      /** Ephemeral governed body. Callers must not persist, log or echo it. */
      body: Uint8Array;
    }>
  | Readonly<{ status: 'blocked'; reason: GovernedDisclosureBlockReason }>;
