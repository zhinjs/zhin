import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeSnapshot, Scope, SnapshotReader } from '@zhin.js/plugin-runtime';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import { FileProjectProfileJournal } from '../workroom/file-profile-journal.js';
import { workroomProjectProfileRegistryToken } from './workroom-assignment-authority-provider.js';
import {
  createWorkroomDynamicPlanningGenerationSnapshot,
  workroomDynamicPlanningPolicyToken,
} from './workroom-dynamic-planning-provider.js';
import {
  FileWorkroomProfileAuthorityRepository,
  FileWorkroomRunProfilePinProofRepository,
  WorkroomProfileAuthorityRuntime,
  type WorkroomProfileAuthorityDecision,
  type WorkroomProfileAuthorityRequest,
  type WorkroomProfileGenerationView,
  type WorkroomProfileGenerationViewPort,
  type WorkroomProfilePublisherAuthorityPort,
  type WorkroomRunProfilePinAuthorityPort,
} from './workroom-profile-authority-runtime.js';

export const WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL = 'control-plane:root';

export interface WorkroomProfileAuthorityResourceScope extends Pick<Scope, 'has' | 'provide'> {}

export interface InstallWorkroomProfileAuthorityResourcesOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly snapshots: SnapshotReader;
  readonly resources: WorkroomProfileAuthorityResourceScope;
  readonly authority: WorkroomProfilePublisherAuthorityPort;
  readonly resolveGenerationView: (snapshot: RuntimeSnapshot) => WorkroomProfileGenerationView;
  readonly runPinAuthority?: WorkroomRunProfilePinAuthorityPort;
}

export interface InstalledWorkroomProfileAuthorityResources {
  /** Private Root control surface. This is intentionally not a Resource token. */
  readonly control: WorkroomProfileAuthorityRuntime['control'];
  /** Private Kernel admission surface. This is intentionally not a Resource token. */
  readonly runPins: WorkroomProfileAuthorityRuntime['runPins'];
  readonly profiles: WorkroomProfileAuthorityRuntime['profiles'];
  readonly planningPolicy: WorkroomProfileAuthorityRuntime['planningPolicy'];
}

/**
 * Installs only governed readers into the generation Scope. Raw repositories,
 * publisher authority and mutation ports stay private to the Root composition.
 */
export function installWorkroomProfileAuthorityResources(
  options: InstallWorkroomProfileAuthorityResourcesOptions,
): InstalledWorkroomProfileAuthorityResources {
  options.signal.throwIfAborted();
  positiveGeneration(options.generation);
  const authorityDirectory = join(options.projectRoot, '.zhin', 'workroom-profile-authority');
  const generationView = createSnapshotWorkroomProfileGenerationView({
    generation: options.generation,
    snapshots: options.snapshots,
    resolve: options.resolveGenerationView,
  });
  const repository = new FileWorkroomProfileAuthorityRepository(authorityDirectory, options.authority);
  const runtime = new WorkroomProfileAuthorityRuntime({
    generation: createWorkroomDynamicPlanningGenerationSnapshot(options.generation),
    repository,
    profileJournal: new FileProjectProfileJournal(
      join(options.projectRoot, '.zhin', 'workroom-project-profiles'),
    ),
    authority: options.authority,
    generationView,
    ...(options.runPinAuthority
      ? {
          runPinAuthority: options.runPinAuthority,
          runPinProofs: new FileWorkroomRunProfilePinProofRepository(
            join(authorityDirectory, 'run-pin-proofs'),
            options.runPinAuthority,
          ),
        }
      : {}),
  });
  if (options.resources.has(workroomProjectProfileRegistryToken)) {
    throw new Error('Workroom Project Profile governed reader is already installed');
  }
  options.resources.provide(workroomProjectProfileRegistryToken, runtime.profiles);
  if (!options.resources.has(workroomDynamicPlanningPolicyToken)) {
    options.resources.provide(workroomDynamicPlanningPolicyToken, runtime.planningPolicy);
  }
  return Object.freeze({
    control: runtime.control,
    runPins: runtime.runPins,
    profiles: runtime.profiles,
    planningPolicy: runtime.planningPolicy,
  });
}

export function createWorkroomProfileGenerationView(input: Readonly<{
  generation: number;
  tools: readonly Readonly<{ id: string; digest: string }>[];
  skills: readonly Readonly<{ id: string; digest: string }>[];
  agents: readonly Readonly<{ id: string; digest: string }>[];
}>): WorkroomProfileGenerationView {
  positiveGeneration(input.generation);
  const body = deepFreeze({
    generation: input.generation,
    tools: canonicalDefinitions(input.tools),
    skills: canonicalDefinitions(input.skills),
    agents: canonicalDefinitions(input.agents),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export function digestWorkroomProfileCatalogProject(definition: unknown): string {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error('Workroom Profile Catalog Project definition is invalid');
  }
  return digest(structuredClone(definition));
}

export function createSnapshotWorkroomProfileGenerationView(options: Readonly<{
  generation: number;
  snapshots: SnapshotReader;
  resolve: (snapshot: RuntimeSnapshot) => WorkroomProfileGenerationView;
}>): WorkroomProfileGenerationViewPort {
  positiveGeneration(options.generation);
  return Object.freeze({
    async withCurrent<TResult>(
      operation: Readonly<{ operationId: string; generation: number; signal: AbortSignal }>,
      use: (view: WorkroomProfileGenerationView) => TResult | Promise<TResult>,
    ) {
      operation.signal.throwIfAborted();
      if (operation.generation !== options.generation) {
        throw new Error('Profile authority operation targets another Root generation');
      }
      const lease = options.snapshots.acquire();
      try {
        if (!options.snapshots.owns(lease) || lease.value.generation !== options.generation) {
          throw new Error('Profile authority generation is no longer current');
        }
        const view = options.resolve(lease.value);
        assertResolvedGenerationView(view, options.generation);
        operation.signal.throwIfAborted();
        return await use(view);
      } finally {
        lease.release();
      }
    },
  });
}

/**
 * Root-local authority. Pack publishers come from a process-owned allowlist;
 * Project mutations re-check the persistent Catalog Sponsor membership.
 */
export function createCatalogWorkroomProfilePublisherAuthority(options: Readonly<{
  catalog: Pick<WorkroomCatalog, 'read'>;
  trustedPackPublishers: readonly string[];
  decisionDirectory: string;
  now?: () => number;
}>): WorkroomProfilePublisherAuthorityPort {
  const publishers = new Set(options.trustedPackPublishers.map(principal => requiredText(principal, 'publisher')));
  const publisherPolicyDigest = digest({ trustedPackPublishers: [...publishers].sort() });
  const decisions = new DurableFileStore(options.decisionDirectory);
  const now = options.now ?? Date.now;
  type AuthorityBasis = Readonly<{
    kind: 'pack_publisher';
    publisherPolicyDigest: string;
  }> | Readonly<{
    kind: 'catalog_sponsor';
    catalogRevision: string;
    projectId: string;
    projectDigest: string;
  }>;
  type PersistedDecision = Readonly<{
    version: 1;
    request: WorkroomProfileAuthorityRequest;
    decision: WorkroomProfileAuthorityDecision;
    basis: AuthorityBasis;
    digest: string;
  }>;
  const resolveBasis = async (
    request: WorkroomProfileAuthorityRequest,
  ): Promise<AuthorityBasis | undefined> => {
    if (request.action === 'publish_pack') {
      return publishers.has(request.authenticatedPrincipalId)
        ? Object.freeze({ kind: 'pack_publisher' as const, publisherPolicyDigest })
        : undefined;
    }
    if (!request.projectId) return undefined;
    const catalog = await options.catalog.read();
    const definition = catalog.definitions[request.projectId];
    return definition?.enabled !== false
      && definition?.sponsors?.includes(request.authenticatedPrincipalId)
      ? Object.freeze({
          kind: 'catalog_sponsor' as const,
          catalogRevision: catalog.revision,
          projectId: request.projectId,
          projectDigest: digest(definition),
        })
      : undefined;
  };
  const targetFor = (request: WorkroomProfileAuthorityRequest) =>
    join(options.decisionDirectory, `${request.digest.slice('sha256:'.length)}.json`);
  const readDecision = async (request: WorkroomProfileAuthorityRequest): Promise<PersistedDecision | undefined> => {
    let raw: string;
    try {
      raw = await readFile(targetFor(request), 'utf8');
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw error;
    }
    const value = JSON.parse(raw) as PersistedDecision;
    if (value.version !== 1 || canonicalWorkroomJson(value.request) !== canonicalWorkroomJson(request)) {
      throw new Error('Persisted Workroom Profile authority decision request drift');
    }
    const { digest: supplied, ...body } = value;
    if (supplied !== digest(body)) throw new Error('Persisted Workroom Profile authority decision digest mismatch');
    return Object.freeze(structuredClone(value));
  };
  return Object.freeze({
    async authorize(request: WorkroomProfileAuthorityRequest) {
      const replay = await readDecision(request);
      if (replay) return replay.decision;
      const basis = await resolveBasis(request);
      if (!basis) {
        return Object.freeze({
          approved: false as const,
          requestDigest: request.digest,
          reason: request.action === 'publish_pack'
            ? 'principal_is_not_trusted_pack_publisher'
            : 'principal_is_not_project_sponsor',
        });
      }
      const role = basis.kind === 'pack_publisher' ? 'trusted_pack_publisher' as const : 'sponsor' as const;
      const decision = Object.freeze({
        approved: true as const,
        requestDigest: request.digest,
        decisionId: `profile-authority:${digest({ requestDigest: request.digest, basis })}`,
        decidedBy: request.authenticatedPrincipalId,
        authorizedBy: role,
        decidedAt: now(),
      });
      const body = Object.freeze({ version: 1 as const, request: structuredClone(request), decision, basis });
      const record = Object.freeze({ ...body, digest: digest(body) });
      await decisions.ensureDurableLeaf('Workroom Profile publisher decision repository');
      const publication = await decisions.publishCreateOnly({
        target: targetFor(request),
        content: canonicalWorkroomJson(record),
        createdValue: record,
        onConflict: async () => {
          const winner = await readDecision(request);
          if (!winner) throw new Error('Workroom Profile authority CAS winner disappeared');
          return winner;
        },
      });
      await decisions.syncLeafAndParent();
      return publication.value.decision;
    },
    async verify(
      request: WorkroomProfileAuthorityRequest,
      decision: WorkroomProfileAuthorityDecision,
    ) {
      const persisted = await readDecision(request);
      return persisted !== undefined
        && canonicalWorkroomJson(persisted.decision) === canonicalWorkroomJson(decision);
    },
  });
}

function assertResolvedGenerationView(view: WorkroomProfileGenerationView, generation: number): void {
  if (view.generation !== generation) throw new Error('Resolved Profile generation view is stale');
  const canonical = {
    generation: view.generation,
    tools: view.tools,
    skills: view.skills,
    agents: view.agents,
  };
  if (!/^sha256:[a-f0-9]{64}$/u.test(view.digest)
    || digest(canonical) !== view.digest
    || canonicalWorkroomJson(canonical).length === 0) {
    throw new Error('Resolved Profile generation view is malformed');
  }
}

function positiveGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Profile authority generation is invalid');
}

function requiredText(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Workroom Profile authority ${name} is invalid`);
  }
  return value;
}

function canonicalDefinitions(
  values: readonly Readonly<{ id: string; digest: string }>[],
): readonly Readonly<{ id: string; digest: string }>[] {
  if (!Array.isArray(values)) throw new Error('Workroom Profile generation definitions are invalid');
  const seen = new Set<string>();
  return deepFreeze(values.map(value => {
    const id = requiredText(value.id, 'generation capability id');
    if (seen.has(id)) throw new Error(`Duplicate Workroom Profile generation capability ${id}`);
    seen.add(id);
    if (!/^sha256:[a-f0-9]{64}$/u.test(value.digest)) {
      throw new Error(`Workroom Profile generation capability ${id} digest is invalid`);
    }
    return { id, digest: value.digest };
  }).sort((left, right) => compareCanonicalWorkroomText(left.id, right.id)));
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
