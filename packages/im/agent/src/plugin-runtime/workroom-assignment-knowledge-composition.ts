import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createToken } from '@zhin.js/plugin-runtime';
import {
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import {
  canonicalProjectKnowledgeSource,
  type ProjectKnowledgeSource,
  type ProjectKnowledgeSourceAuthorityPort,
} from '../workroom/project-knowledge-registry.js';
import type {
  WorkroomEphemeralAssignmentContextPublisher,
  WorkroomGovernedKnowledgeContentReader,
  WorkroomAssignmentKnowledgeContextProjector,
} from '../workroom/workroom-assignment-knowledge-context.js';
import type { WorkroomDisclosureManifestAuthorityPort } from './workroom-data-governance-runtime.js';

export interface WorkroomEphemeralAssignmentContext {
  readonly ref: string;
  readonly hash: string;
  readonly assignmentId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly body: unknown;
}

export interface WorkroomEphemeralAssignmentContextPort
extends WorkroomEphemeralAssignmentContextPublisher {
  read(ref: string, hash: string): WorkroomEphemeralAssignmentContext | undefined;
  releaseTask(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
  }>): Readonly<{
    status: 'released';
    released: number;
    receiptRef: string;
    digest: string;
  }>;
  dispose(): void;
}

export const workroomEphemeralAssignmentContextToken =
  createToken<WorkroomEphemeralAssignmentContextPort>(
    'zhin.agent.workroom-ephemeral-assignment-context',
    'Generation-owned ephemeral Assignment Knowledge Context; bodies are never persisted',
  );

export const workroomAssignmentKnowledgeContextToken =
  createToken<WorkroomAssignmentKnowledgeContextProjector>(
    'zhin.agent.workroom-assignment-knowledge-context',
    'Exact Profile/Project Knowledge projection and P12 reauthorization for Assignments',
  );

export interface CatalogProjectKnowledgeSourceAuthority
extends ProjectKnowledgeSourceAuthorityPort {
  issueSponsorDecision(input: Readonly<{
    operationId: string;
    projectId: string;
    principalId: string;
  }>): Promise<Extract<ProjectKnowledgeSource, { kind: 'sponsor_decision' }>>;
}

/** Durable historical Sponsor proof; later Catalog edits cannot rewrite past authority. */
export function createCatalogProjectKnowledgeSourceAuthority(options: Readonly<{
  catalog: Pick<WorkroomCatalog, 'read'>;
  directory: string;
}>): CatalogProjectKnowledgeSourceAuthority {
  const store = new DurableFileStore(options.directory);
  type Proof = Readonly<{
    version: 1;
    source: Extract<ProjectKnowledgeSource, { kind: 'sponsor_decision' }>;
    principalId: string;
    catalogRevision: string;
    projectDigest: string;
    digest: string;
  }>;
  const target = (sourceId: string) => join(options.directory,
    `${createHash('sha256').update(sourceId).digest('hex')}.json`);
  const read = async (sourceId: string): Promise<Proof | undefined> => {
    try {
      const value = JSON.parse(await readFile(target(sourceId), 'utf8')) as Proof;
      const body = {
        version: 1, source: value.source, principalId: value.principalId,
        catalogRevision: value.catalogRevision, projectDigest: value.projectDigest,
      } as const;
      const canonical = { ...body, digest: digest(body) };
      if (value.version !== 1 || value.digest !== canonical.digest
        || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
        throw new Error('Project Knowledge Sponsor proof digest mismatch');
      }
      canonicalProjectKnowledgeSource(value.source);
      return value;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const authority: CatalogProjectKnowledgeSourceAuthority = {
    async issueSponsorDecision(input: Parameters<CatalogProjectKnowledgeSourceAuthority['issueSponsorDecision']>[0]) {
      const catalog = await options.catalog.read();
      const definition = catalog.definitions[input.projectId];
      if (!definition || definition.enabled === false || !definition.sponsors?.includes(input.principalId)) {
        throw new Error('Project Knowledge control requires a current Catalog Sponsor');
      }
      const source = canonicalProjectKnowledgeSource({
        kind: 'sponsor_decision', projectId: input.projectId,
        sourceId: `console-knowledge:${input.operationId}`,
        digest: digest({
          kind: 'sponsor_decision', projectId: input.projectId,
          sourceId: `console-knowledge:${input.operationId}`,
        }),
      }) as Extract<ProjectKnowledgeSource, { kind: 'sponsor_decision' }>;
      const body = {
        version: 1 as const, source, principalId: input.principalId,
        catalogRevision: catalog.revision, projectDigest: digest(definition),
      };
      const proof: Proof = Object.freeze({ ...body, digest: digest(body) });
      await store.ensureDurableLeaf('Project Knowledge Sponsor authority');
      const result = await store.publishCreateOnly({
        target: target(source.sourceId), content: canonicalWorkroomJson(proof), createdValue: proof,
        onConflict: async () => {
          const winner = await read(source.sourceId);
          if (!winner || canonicalWorkroomJson(winner) !== canonicalWorkroomJson(proof)) {
            throw new Error('Project Knowledge Sponsor operation identity drift');
          }
          return winner;
        },
      });
      await store.syncLeafAndParent();
      return result.value.source;
    },
    async verify(source: ProjectKnowledgeSource) {
      const canonical = canonicalProjectKnowledgeSource(source);
      if (canonical.kind !== 'sponsor_decision') return false;
      const proof = await read(canonical.sourceId);
      return Boolean(proof && canonicalWorkroomJson(proof.source) === canonicalWorkroomJson(canonical));
    },
  };
  return Object.freeze(authority);
}

/**
 * P12 adapter. Every read creates and immediately revalidates an exact
 * Assignment-scoped Disclosure Manifest. Missing sink policy fails closed.
 */
export function createP12WorkroomKnowledgeContentReader(options: Readonly<{
  governance: WorkroomDisclosureManifestAuthorityPort;
  signal: AbortSignal;
  sinkRuleId?: string;
}>): WorkroomGovernedKnowledgeContentReader {
  const sinkRuleId = options.sinkRuleId ?? 'assignment-context';
  const reader: WorkroomGovernedKnowledgeContentReader = {
    async read(input: Parameters<WorkroomGovernedKnowledgeContentReader['read']>[0]) {
      options.signal.throwIfAborted();
      const operationId = `assignment-knowledge:${input.assignmentId}:${input.handle.knowledgeId}:${input.projectionDigest}`;
      const request = Object.freeze({
        operationId,
        projectId: input.projectId,
        sourceRef: input.handle.governedContent.ref,
        sourceDigest: input.handle.governedContent.digest,
        sinkRuleId,
        principalId: input.principalId,
        assignmentId: input.assignmentId,
      });
      const manifest = await options.governance.materialize(request, options.signal);
      if (!manifest || manifest.output.mode !== 'full'
        || manifest.source.objectId !== input.handle.governedContent.ref
        || manifest.source.payloadHash !== input.handle.governedContent.digest
        || manifest.principal.assignmentId !== input.assignmentId
        || manifest.principal.principalId !== input.principalId) return undefined;
      const revalidated = await options.governance.revalidate({ request, manifest }, options.signal);
      if (revalidated.status !== 'ready') return undefined;
      const contentDigest = hashBytes(revalidated.body);
      if (contentDigest !== input.handle.governedContent.digest) return undefined;
      const bodyText = new TextDecoder('utf-8', { fatal: true }).decode(revalidated.body);
      let body: unknown = bodyText;
      try {
        body = JSON.parse(bodyText) as unknown;
      } catch {
        // Governed knowledge may be plain text. It remains ephemeral either way.
      }
      return Object.freeze({
        body,
        contentDigest,
        authorizationDigest: digest({
          requestDigest: manifest.requestDigest,
          manifestDigest: manifest.digest,
          projectionDigest: input.projectionDigest,
          profileDigest: input.profileDigest,
          knowledgeRevision: input.knowledgeRevision,
        }),
      });
    },
  };
  return Object.freeze(reader);
}

export function createGenerationWorkroomEphemeralAssignmentContext(options: Readonly<{
  generation: number;
  signal: AbortSignal;
}>): WorkroomEphemeralAssignmentContextPort {
  if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
    throw new Error('Ephemeral Assignment Context generation is invalid');
  }
  const contexts = new Map<string, WorkroomEphemeralAssignmentContext>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    contexts.clear();
  };
  options.signal.addEventListener('abort', dispose, { once: true });
  const provider: WorkroomEphemeralAssignmentContextPort = {
    async publish(input: Parameters<WorkroomEphemeralAssignmentContextPublisher['publish']>[0]) {
      if (disposed) throw new Error('Ephemeral Assignment Context generation is retired');
      options.signal.throwIfAborted();
      const ref = `assignment-context:${options.generation}:${encodeURIComponent(input.assignmentId)}:${input.expectedHash}`;
      const previous = contexts.get(ref);
      if (previous) {
        if (previous.hash !== input.expectedHash || previous.assignmentId !== input.assignmentId
          || previous.principalId !== input.principalId
          || previous.projectId !== input.projection.projectId
          || previous.runId !== input.projection.runId
          || previous.taskKey !== input.projection.taskKey) {
          throw new Error('Ephemeral Assignment Context identity drift');
        }
        return Object.freeze({ ref, hash: previous.hash });
      }
      contexts.set(ref, Object.freeze({
        ref,
        hash: input.expectedHash,
        assignmentId: input.assignmentId,
        principalId: input.principalId,
        projectId: input.projection.projectId,
        runId: input.projection.runId,
        taskKey: input.projection.taskKey,
        body: structuredClone({ projection: input.projection, contents: input.contents }),
      }));
      return Object.freeze({ ref, hash: input.expectedHash });
    },
    read(ref: string, hash: string) {
      if (disposed || options.signal.aborted) return undefined;
      const value = contexts.get(ref);
      if (!value || value.hash !== hash) return undefined;
      return Object.freeze({
        ref: value.ref,
        hash: value.hash,
        assignmentId: value.assignmentId,
        principalId: value.principalId,
        projectId: value.projectId,
        runId: value.runId,
        taskKey: value.taskKey,
        body: structuredClone(value.body),
      });
    },
    releaseTask(input: Parameters<WorkroomEphemeralAssignmentContextPort['releaseTask']>[0]) {
      if (disposed) throw new Error('Ephemeral Assignment Context generation is retired');
      options.signal.throwIfAborted();
      const releasedContextRefs = [...contexts.values()]
        .filter(context => context.projectId === input.projectId
          && context.runId === input.runId && context.taskKey === input.taskKey)
        .map(context => context.ref)
        .sort();
      for (const ref of releasedContextRefs) contexts.delete(ref);
      const body = Object.freeze({
        status: 'released' as const,
        released: releasedContextRefs.length,
        receiptRef: `ephemeral-context-release:${options.generation}:${digest({ input, releasedContextRefs })}`,
      });
      return Object.freeze({ ...body, digest: digest(body) });
    },
    dispose,
  };
  return Object.freeze(provider);
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
