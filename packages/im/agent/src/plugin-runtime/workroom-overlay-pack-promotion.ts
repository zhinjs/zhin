import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import type { CapabilityPack, CapabilityPackRef } from '../workroom/profile-compiler.js';
import {
  canonicalProjectKnowledgeSource,
  type ProjectKnowledgeSource,
  type ProjectKnowledgeSourceAuthorityPort,
} from '../workroom/project-knowledge-registry.js';
import {
  createCapabilityPackManifest,
  type CapabilityPackPublication,
  type PublishCapabilityPackCommand,
  type WorkroomProfileGenerationViewPort,
} from './workroom-profile-authority-runtime.js';

export interface OverlayPackPromotionCheck {
  readonly id: string;
  readonly revision: string;
  readonly status: 'passed';
  readonly digest: string;
}

export interface OverlayPackPromotionReview {
  readonly reviewerPrincipalId: string;
  readonly decisionId: string;
  readonly status: 'approved';
  readonly digest: string;
}

export interface OverlayPackPromotionSemanticDiff {
  readonly basePackRef?: CapabilityPackRef;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /** Fail-closed: new/removal/change can widen authority or relax policy. */
  readonly authorityExpansion: boolean;
  readonly digest: string;
}

export interface OverlayPackPromotionAuthorityRequest {
  readonly version: 1;
  readonly generation: number;
  readonly promotionId: string;
  readonly projectId: string;
  readonly overlayRevisionId: string;
  readonly overlayDigest: string;
  readonly ownerPrincipalId: string;
  readonly sourcesDigest: string;
  readonly checksDigest: string;
  readonly reviewDigest: string;
  readonly packDigest: string;
  readonly semanticDiff: OverlayPackPromotionSemanticDiff;
  readonly digest: string;
}

export type OverlayPackPromotionAuthorityDecision =
  | Readonly<{
      approved: true;
      requestDigest: string;
      decisionId: string;
      decidedBy: string;
      route: 'reviewer' | 'sponsor';
    }>
  | Readonly<{ approved: false; requestDigest: string; reason: string }>;

export interface OverlayPackPromotionAuthorityPort {
  authorize(request: OverlayPackPromotionAuthorityRequest): Promise<OverlayPackPromotionAuthorityDecision>;
  verify(
    request: OverlayPackPromotionAuthorityRequest,
    decision: Extract<OverlayPackPromotionAuthorityDecision, { approved: true }>,
  ): Promise<boolean>;
}

export interface PromoteOverlayPackCommand {
  readonly version: 1;
  readonly generation: number;
  readonly operationId: string;
  readonly promotionId: string;
  readonly projectId: string;
  readonly overlayRevisionId: string;
  readonly overlayDigest: string;
  readonly ownerPrincipalId: string;
  readonly sources: readonly ProjectKnowledgeSource[];
  readonly checks: readonly OverlayPackPromotionCheck[];
  readonly review: OverlayPackPromotionReview;
  readonly pack: CapabilityPack;
  readonly basePackRef?: CapabilityPackRef;
}

export interface OverlayPackPromotionPreparedRecord {
  readonly version: 1;
  readonly status: 'prepared';
  readonly generation: number;
  readonly operationId: string;
  readonly commandDigest: string;
  readonly promotionId: string;
  readonly projectId: string;
  readonly overlayRevisionId: string;
  readonly overlayDigest: string;
  readonly ownerPrincipalId: string;
  readonly sources: readonly ProjectKnowledgeSource[];
  readonly checks: readonly OverlayPackPromotionCheck[];
  readonly review: OverlayPackPromotionReview;
  readonly pack: CapabilityPack;
  readonly packRef: CapabilityPackRef;
  readonly semanticDiff: OverlayPackPromotionSemanticDiff;
  readonly authorityRequest: OverlayPackPromotionAuthorityRequest;
  readonly governance: Extract<OverlayPackPromotionAuthorityDecision, { approved: true }>;
  readonly digest: string;
}

export interface OverlayPackPromotionPublishedRecord extends Omit<OverlayPackPromotionPreparedRecord, 'status' | 'digest'> {
  readonly status: 'published';
  readonly publicationDigest: string;
  readonly digest: string;
}

export type OverlayPackPromotionRecord = OverlayPackPromotionPreparedRecord | OverlayPackPromotionPublishedRecord;

export function canonicalOverlayPackPromotionRecord(
  value: OverlayPackPromotionRecord,
): OverlayPackPromotionRecord {
  return value.status === 'published' ? canonicalPublished(value) : canonicalPrepared(value);
}

export function preparedOverlayPackPromotionRecord(
  value: OverlayPackPromotionPublishedRecord,
): OverlayPackPromotionPreparedRecord {
  const { status: _status, publicationDigest: _publicationDigest, digest: _digest, ...body } = value;
  return canonicalPrepared(deepFreeze({ ...body, status: 'prepared', digest: digest({ ...body, status: 'prepared' }) }));
}

export interface OverlayPackPromotionRepository {
  read(promotionId: string): Promise<OverlayPackPromotionRecord | undefined>;
  prepare(record: OverlayPackPromotionPreparedRecord): Promise<OverlayPackPromotionRecord>;
  markPublished(record: OverlayPackPromotionPublishedRecord): Promise<OverlayPackPromotionPublishedRecord>;
  list(projectId: string): Promise<readonly OverlayPackPromotionRecord[]>;
}

export class MemoryOverlayPackPromotionRepository implements OverlayPackPromotionRepository {
  readonly #records = new Map<string, OverlayPackPromotionRecord>();

  async read(promotionId: string): Promise<OverlayPackPromotionRecord | undefined> {
    return this.#records.get(text(promotionId, 'Promotion id'));
  }

  async prepare(record: OverlayPackPromotionPreparedRecord): Promise<OverlayPackPromotionRecord> {
    const canonical = canonicalPrepared(record);
    const current = this.#records.get(canonical.promotionId);
    if (current) {
      if (current.commandDigest !== canonical.commandDigest) throw new Error('Overlay Pack promotion identity drift');
      return current;
    }
    this.#records.set(canonical.promotionId, canonical);
    return canonical;
  }

  async markPublished(record: OverlayPackPromotionPublishedRecord): Promise<OverlayPackPromotionPublishedRecord> {
    const canonical = canonicalPublished(record);
    const current = this.#records.get(canonical.promotionId);
    if (!current || current.commandDigest !== canonical.commandDigest) {
      throw new Error('Overlay Pack promotion prepared record is unavailable or stale');
    }
    if (current.status === 'published') {
      if (current.digest !== canonical.digest) throw new Error('Overlay Pack promotion publication drift');
      return current;
    }
    this.#records.set(canonical.promotionId, canonical);
    return canonical;
  }

  async list(projectId: string): Promise<readonly OverlayPackPromotionRecord[]> {
    return deepFreeze([...this.#records.values()].filter(record => record.projectId === projectId)
      .sort((left, right) => compareCanonicalWorkroomText(left.promotionId, right.promotionId)));
  }
}

/** Crash-durable two-stage repository. Parent directory must already exist. */
export class FileOverlayPackPromotionRepository implements OverlayPackPromotionRepository {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(promotionId: string): Promise<OverlayPackPromotionRecord | undefined> {
    const id = text(promotionId, 'Promotion id');
    const key = keyHash(id);
    const published = await readOptional(join(this.directory, `${key}.published.json`));
    if (published) {
      const canonical = canonicalPublished(published as OverlayPackPromotionPublishedRecord);
      const prepared = await readOptional(join(this.directory, `${key}.prepared.json`));
      if (!prepared || canonical.promotionId !== id
        || canonicalPrepared(prepared as OverlayPackPromotionPreparedRecord).commandDigest !== canonical.commandDigest) {
        throw new Error('Overlay Pack promotion two-stage record binding mismatch');
      }
      return canonical;
    }
    const prepared = await readOptional(join(this.directory, `${key}.prepared.json`));
    if (!prepared) return undefined;
    const canonical = canonicalPrepared(prepared as OverlayPackPromotionPreparedRecord);
    if (canonical.promotionId !== id) throw new Error('Overlay Pack promotion repository key mismatch');
    return canonical;
  }

  async prepare(record: OverlayPackPromotionPreparedRecord): Promise<OverlayPackPromotionRecord> {
    const canonical = canonicalPrepared(record);
    const current = await this.read(canonical.promotionId);
    if (current) {
      if (current.commandDigest !== canonical.commandDigest) throw new Error('Overlay Pack promotion identity drift');
      return current;
    }
    await this.#store.ensureDurableLeaf('Overlay Pack Promotion repository');
    const target = join(this.directory, `${keyHash(canonical.promotionId)}.prepared.json`);
    const result = await this.#store.publishCreateOnly({
      target, content: canonicalWorkroomJson(canonical), createdValue: canonical,
      onConflict: async () => {
        const winner = await this.read(canonical.promotionId);
        if (!winner || winner.commandDigest !== canonical.commandDigest) throw new Error('Overlay Pack promotion identity drift');
        return winner;
      },
    });
    await this.#store.syncLeafAndParent();
    return result.value;
  }

  async markPublished(record: OverlayPackPromotionPublishedRecord): Promise<OverlayPackPromotionPublishedRecord> {
    const canonical = canonicalPublished(record);
    const prepared = await this.read(canonical.promotionId);
    if (!prepared || prepared.commandDigest !== canonical.commandDigest) {
      throw new Error('Overlay Pack promotion prepared record is unavailable or stale');
    }
    if (prepared.status === 'published') {
      if (prepared.digest !== canonical.digest) throw new Error('Overlay Pack promotion publication drift');
      return prepared;
    }
    const target = join(this.directory, `${keyHash(canonical.promotionId)}.published.json`);
    const result = await this.#store.publishCreateOnly({
      target, content: canonicalWorkroomJson(canonical), createdValue: canonical,
      onConflict: async () => {
        const winner = await this.read(canonical.promotionId);
        if (!winner || winner.status !== 'published' || winner.digest !== canonical.digest) {
          throw new Error('Overlay Pack promotion publication drift');
        }
        return winner;
      },
    });
    await this.#store.syncLeafAndParent();
    return result.value;
  }

  async list(projectId: string): Promise<readonly OverlayPackPromotionRecord[]> {
    text(projectId, 'Promotion Project id');
    let names: readonly string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const ids = new Set<string>();
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.(?:prepared|published)\.json$/u.test(name)) {
        throw new Error('Invalid Overlay Pack Promotion repository entry');
      }
      ids.add(name.slice(0, 64));
    }
    const records = await Promise.all([...ids].map(async id => {
      const published = await readOptional(join(this.directory, `${id}.published.json`));
      if (published) {
        const canonical = canonicalPublished(published as OverlayPackPromotionPublishedRecord);
        const prepared = await readOptional(join(this.directory, `${id}.prepared.json`));
        if (!prepared || keyHash(canonical.promotionId) !== id
          || canonicalPrepared(prepared as OverlayPackPromotionPreparedRecord).commandDigest !== canonical.commandDigest) {
          throw new Error('Overlay Pack promotion two-stage record binding mismatch');
        }
        return canonical;
      }
      const prepared = await readOptional(join(this.directory, `${id}.prepared.json`));
      if (!prepared) throw new Error('Overlay Pack Promotion repository index drift');
      const canonical = canonicalPrepared(prepared as OverlayPackPromotionPreparedRecord);
      if (keyHash(canonical.promotionId) !== id) throw new Error('Overlay Pack promotion repository key mismatch');
      return canonical;
    }));
    return deepFreeze(records.filter(record => record.projectId === projectId)
      .sort((left, right) => compareCanonicalWorkroomText(left.promotionId, right.promotionId)));
  }
}

export interface OverlayPackSharedPublicationPort {
  read(ref: CapabilityPackRef): Promise<CapabilityPackPublication | undefined>;
  publish(command: PublishCapabilityPackCommand, signal: AbortSignal): Promise<CapabilityPackPublication>;
}

export interface WorkroomOverlayPackPromotionOptions {
  readonly generation: number;
  readonly generationView: WorkroomProfileGenerationViewPort;
  readonly repository: OverlayPackPromotionRepository;
  readonly sourceAuthority: ProjectKnowledgeSourceAuthorityPort;
  readonly authority: OverlayPackPromotionAuthorityPort;
  readonly sharedPacks: OverlayPackSharedPublicationPort;
  readonly publisherPrincipalId: string;
}

export class WorkroomOverlayPackPromotionRuntime {
  constructor(readonly options: WorkroomOverlayPackPromotionOptions) {}

  async promote(command: PromoteOverlayPackCommand, signal: AbortSignal): Promise<OverlayPackPromotionPublishedRecord> {
    const canonical = canonicalCommand(command);
    signal.throwIfAborted();
    return await this.options.generationView.withCurrent({
      operationId: canonical.operationId, generation: canonical.generation, signal,
    }, async () => {
      if (canonical.generation !== this.options.generation) throw new Error('Overlay promotion generation is stale');
      await this.#verifySources(canonical.sources, canonical.projectId);
      const current = canonical.basePackRef
        ? await this.options.sharedPacks.read(canonical.basePackRef)
        : undefined;
      if (canonical.basePackRef && !current) throw new Error('Overlay promotion base Pack is unavailable');
      const semanticDiff = createSemanticDiff(current?.pack, canonical.pack, canonical.basePackRef);
      const request = createAuthorityRequest(canonical, semanticDiff);
      const previous = await this.options.repository.read(canonical.promotionId);
      if (previous) {
        if (previous.commandDigest !== digest(canonical)) throw new Error('Overlay Pack promotion identity drift');
        await this.#verifyDecision(previous.authorityRequest, previous.governance);
        if (previous.status === 'published') return previous;
        return await this.#publish(previous, signal);
      }
      const decision = await this.options.authority.authorize(request);
      if (!decision.approved) throw new Error(`Overlay Pack promotion denied: ${decision.reason}`);
      if (decision.requestDigest !== request.digest) throw new Error('Overlay Pack promotion decision scope mismatch');
      if (semanticDiff.authorityExpansion && decision.route !== 'sponsor') {
        throw new Error('Sponsor governance is required for Overlay Pack promotion authority expansion');
      }
      await this.#verifyDecision(request, decision);
      const body = deepFreeze({
        version: 1 as const,
        status: 'prepared' as const,
        generation: canonical.generation,
        operationId: canonical.operationId,
        commandDigest: digest(canonical),
        promotionId: canonical.promotionId,
        projectId: canonical.projectId,
        overlayRevisionId: canonical.overlayRevisionId,
        overlayDigest: canonical.overlayDigest,
        ownerPrincipalId: canonical.ownerPrincipalId,
        sources: canonical.sources,
        checks: canonical.checks,
        review: canonical.review,
        pack: canonical.pack,
        packRef: packRef(canonical.pack),
        semanticDiff,
        authorityRequest: request,
        governance: decision,
      });
      const prepared = canonicalPrepared(deepFreeze({ ...body, digest: digest(body) }));
      const persisted = await this.options.repository.prepare(prepared);
      if (persisted.status === 'published') return persisted;
      return await this.#publish(persisted, signal);
    });
  }

  async #publish(prepared: OverlayPackPromotionPreparedRecord, signal: AbortSignal): Promise<OverlayPackPromotionPublishedRecord> {
    signal.throwIfAborted();
    const { digest: _packDigest, ...pack } = prepared.pack;
    const publication = await this.options.sharedPacks.publish({
      version: 1,
      operationId: `overlay-promotion:${prepared.promotionId}`,
      authenticatedPrincipalId: this.options.publisherPrincipalId,
      pack,
    }, signal);
    if (publication.pack.id !== prepared.pack.id || publication.pack.version !== prepared.pack.version
      || publication.pack.digest !== prepared.pack.digest) {
      throw new Error('Shared Capability Pack publication does not match Overlay promotion');
    }
    const { status: _status, digest: _digest, ...base } = prepared;
    const body = deepFreeze({ ...base, status: 'published' as const, publicationDigest: publication.digest });
    return await this.options.repository.markPublished(deepFreeze({ ...body, digest: digest(body) }));
  }

  async #verifySources(sources: readonly ProjectKnowledgeSource[], projectId: string): Promise<void> {
    for (const source of sources) {
      if (source.projectId !== projectId) throw new Error('Overlay promotion source Project binding mismatch');
      const canonical = canonicalProjectKnowledgeSource(source);
      if (!await this.options.sourceAuthority.verify(canonical)) {
        throw new Error('Overlay promotion source authority denied');
      }
    }
  }

  async #verifyDecision(
    request: OverlayPackPromotionAuthorityRequest,
    decision: Extract<OverlayPackPromotionAuthorityDecision, { approved: true }>,
  ): Promise<void> {
    if (!await this.options.authority.verify(request, decision)) {
      throw new Error('Overlay Pack promotion persisted governance verification denied');
    }
  }
}

function canonicalCommand(value: PromoteOverlayPackCommand): PromoteOverlayPackCommand {
  assertKeys(value, [
    'version', 'generation', 'operationId', 'promotionId', 'projectId', 'overlayRevisionId', 'overlayDigest',
    'ownerPrincipalId', 'sources', 'checks', 'review', 'pack', 'basePackRef',
  ].filter(key => key !== 'basePackRef' || value.basePackRef !== undefined), 'Overlay Pack promotion command');
  if (value.version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 0) {
    throw new Error('Overlay Pack promotion command version/generation is invalid');
  }
  if (value.sources.length === 0) throw new Error('Overlay Pack promotion authoritative source is required');
  if (value.checks.length === 0) throw new Error('Overlay Pack promotion passed check is required');
  const pack = canonicalPack(value.pack);
  const sources = value.sources.map(canonicalProjectKnowledgeSource).sort((left, right) => compareCanonicalWorkroomText(left.sourceId, right.sourceId));
  const checks = value.checks.map(canonicalCheck).sort((left, right) => compareCanonicalWorkroomText(left.id, right.id));
  if (new Set(checks.map(check => check.id)).size !== checks.length) throw new Error('Overlay Pack promotion check id is duplicated');
  return deepFreeze({
    version: 1,
    generation: value.generation,
    operationId: text(value.operationId, 'Promotion operationId'),
    promotionId: text(value.promotionId, 'Promotion id'),
    projectId: text(value.projectId, 'Promotion Project id'),
    overlayRevisionId: text(value.overlayRevisionId, 'Promotion Overlay revisionId'),
    overlayDigest: requiredDigest(value.overlayDigest, 'Promotion Overlay digest'),
    ownerPrincipalId: text(value.ownerPrincipalId, 'Promotion owner principalId'),
    sources,
    checks,
    review: canonicalReview(value.review),
    pack,
    ...(value.basePackRef ? { basePackRef: canonicalPackRef(value.basePackRef) } : {}),
  });
}

function createSemanticDiff(
  base: CapabilityPack | undefined,
  candidate: CapabilityPack,
  basePackRef: CapabilityPackRef | undefined,
): OverlayPackPromotionSemanticDiff {
  const before = capabilitySemantics(base);
  const after = capabilitySemantics(candidate);
  const added = [...after.keys()].filter(key => !before.has(key)).sort();
  const removed = [...before.keys()].filter(key => !after.has(key)).sort();
  const changed = [...after.keys()].filter(key => before.has(key) && before.get(key) !== after.get(key)).sort();
  const body = deepFreeze({
    ...(basePackRef ? { basePackRef: canonicalPackRef(basePackRef) } : {}),
    added,
    removed,
    changed,
    authorityExpansion: added.length > 0 || removed.length > 0 || changed.length > 0 || base?.kind !== candidate.kind,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function createAuthorityRequest(
  command: PromoteOverlayPackCommand,
  semanticDiff: OverlayPackPromotionSemanticDiff,
): OverlayPackPromotionAuthorityRequest {
  const body = deepFreeze({
    version: 1 as const,
    generation: command.generation,
    promotionId: command.promotionId,
    projectId: command.projectId,
    overlayRevisionId: command.overlayRevisionId,
    overlayDigest: command.overlayDigest,
    ownerPrincipalId: command.ownerPrincipalId,
    sourcesDigest: digest(command.sources),
    checksDigest: digest(command.checks),
    reviewDigest: command.review.digest,
    packDigest: command.pack.digest,
    semanticDiff,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function canonicalPrepared(value: OverlayPackPromotionPreparedRecord): OverlayPackPromotionPreparedRecord {
  if (value.status !== 'prepared') throw new Error('Overlay Pack promotion prepared status is invalid');
  const sources = value.sources.map(canonicalProjectKnowledgeSource);
  if (sources.some(source => source.projectId !== value.projectId)) {
    throw new Error('Overlay promotion source Project binding mismatch');
  }
  const checks = value.checks.map(canonicalCheck);
  if (checks.length === 0 || new Set(checks.map(check => check.id)).size !== checks.length) {
    throw new Error('Overlay Pack promotion passed unique check is required');
  }
  const pack = canonicalPack(value.pack);
  const packReference = canonicalPackRef(value.packRef);
  if (canonicalWorkroomJson(packReference) !== canonicalWorkroomJson(packRef(pack))) {
    throw new Error('Overlay Pack promotion Pack ref binding mismatch');
  }
  const review = canonicalReview(value.review);
  const semanticDiff = canonicalSemanticDiff(value.semanticDiff);
  const command = canonicalCommand({
    version: 1,
    generation: value.generation,
    operationId: value.operationId,
    promotionId: value.promotionId,
    projectId: value.projectId,
    overlayRevisionId: value.overlayRevisionId,
    overlayDigest: value.overlayDigest,
    ownerPrincipalId: value.ownerPrincipalId,
    sources,
    checks,
    review,
    pack,
    ...(semanticDiff.basePackRef ? { basePackRef: semanticDiff.basePackRef } : {}),
  });
  if (value.commandDigest !== digest(command)) throw new Error('Overlay Pack promotion command digest mismatch');
  const authorityRequest = canonicalAuthorityRequest(value.authorityRequest);
  const expectedRequest = createAuthorityRequest(command, semanticDiff);
  if (canonicalWorkroomJson(authorityRequest) !== canonicalWorkroomJson(expectedRequest)) {
    throw new Error('Overlay Pack promotion authority request scope mismatch');
  }
  const governance = canonicalDecision(value.governance, authorityRequest);
  if (semanticDiff.authorityExpansion && governance.route !== 'sponsor') {
    throw new Error('Sponsor governance is required for persisted Overlay Pack promotion expansion');
  }
  const body = deepFreeze({
    version: 1 as const, status: 'prepared' as const, generation: value.generation,
    operationId: text(value.operationId, 'Promotion operationId'),
    commandDigest: requiredDigest(value.commandDigest, 'Promotion command digest'),
    promotionId: text(value.promotionId, 'Promotion id'), projectId: text(value.projectId, 'Promotion Project id'),
    overlayRevisionId: text(value.overlayRevisionId, 'Promotion Overlay revisionId'),
    overlayDigest: requiredDigest(value.overlayDigest, 'Promotion Overlay digest'),
    ownerPrincipalId: text(value.ownerPrincipalId, 'Promotion owner principalId'),
    sources, checks, review, pack, packRef: packReference,
    semanticDiff, authorityRequest, governance,
  });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.version !== 1 || value.digest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Overlay Pack promotion prepared record digest mismatch');
  }
  return canonical;
}

function canonicalPublished(value: OverlayPackPromotionPublishedRecord): OverlayPackPromotionPublishedRecord {
  const { status: _status, publicationDigest, digest: _digest, ...preparedBody } = value;
  const prepared = canonicalPrepared({ ...preparedBody, status: 'prepared', digest: digest({ ...preparedBody, status: 'prepared' }) });
  const { status: _preparedStatus, digest: _preparedDigest, ...base } = prepared;
  const body = deepFreeze({ ...base, status: 'published' as const, publicationDigest: requiredDigest(publicationDigest, 'Promotion publication digest') });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.status !== 'published' || value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Overlay Pack promotion published record digest mismatch');
  }
  return canonical;
}

function canonicalPack(value: CapabilityPack): CapabilityPack {
  const { digest: supplied, ...input } = value;
  const canonical = createCapabilityPackManifest(input);
  if (supplied !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Overlay promotion Capability Pack digest mismatch');
  }
  return canonical;
}

function canonicalCheck(value: OverlayPackPromotionCheck): OverlayPackPromotionCheck {
  assertKeys(value, ['id', 'revision', 'status', 'digest'], 'Overlay Pack promotion check');
  if (value.status !== 'passed') throw new Error('Overlay Pack promotion check must pass');
  return deepFreeze({ id: text(value.id, 'Promotion check id'), revision: text(value.revision, 'Promotion check revision'), status: 'passed', digest: requiredDigest(value.digest, 'Promotion check digest') });
}

function canonicalReview(value: OverlayPackPromotionReview): OverlayPackPromotionReview {
  assertKeys(value, ['reviewerPrincipalId', 'decisionId', 'status', 'digest'], 'Overlay Pack promotion review');
  if (value.status !== 'approved') throw new Error('Overlay Pack promotion review must be approved');
  return deepFreeze({ reviewerPrincipalId: text(value.reviewerPrincipalId, 'Promotion reviewer'), decisionId: text(value.decisionId, 'Promotion review decisionId'), status: 'approved', digest: requiredDigest(value.digest, 'Promotion review digest') });
}

function canonicalSemanticDiff(value: OverlayPackPromotionSemanticDiff): OverlayPackPromotionSemanticDiff {
  const body = deepFreeze({
    ...(value.basePackRef ? { basePackRef: canonicalPackRef(value.basePackRef) } : {}),
    added: unique(value.added), removed: unique(value.removed), changed: unique(value.changed),
    authorityExpansion: value.authorityExpansion === true,
  });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.digest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Overlay Pack promotion semantic diff digest mismatch');
  }
  return canonical;
}

function canonicalAuthorityRequest(value: OverlayPackPromotionAuthorityRequest): OverlayPackPromotionAuthorityRequest {
  const body = deepFreeze({
    version: 1 as const, generation: value.generation, promotionId: text(value.promotionId, 'Promotion request id'),
    projectId: text(value.projectId, 'Promotion request Project'),
    overlayRevisionId: text(value.overlayRevisionId, 'Promotion request Overlay revision'),
    overlayDigest: requiredDigest(value.overlayDigest, 'Promotion request Overlay digest'),
    ownerPrincipalId: text(value.ownerPrincipalId, 'Promotion request owner'),
    sourcesDigest: requiredDigest(value.sourcesDigest, 'Promotion request sources digest'),
    checksDigest: requiredDigest(value.checksDigest, 'Promotion request checks digest'),
    reviewDigest: requiredDigest(value.reviewDigest, 'Promotion request review digest'),
    packDigest: requiredDigest(value.packDigest, 'Promotion request Pack digest'),
    semanticDiff: canonicalSemanticDiff(value.semanticDiff),
  });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.version !== 1 || value.digest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Overlay Pack promotion authority request digest mismatch');
  }
  return canonical;
}

function canonicalDecision(
  value: Extract<OverlayPackPromotionAuthorityDecision, { approved: true }>,
  request: OverlayPackPromotionAuthorityRequest,
): Extract<OverlayPackPromotionAuthorityDecision, { approved: true }> {
  if (value.approved !== true || value.requestDigest !== request.digest || !['reviewer', 'sponsor'].includes(value.route)) {
    throw new Error('Overlay Pack promotion governance scope mismatch');
  }
  return deepFreeze({ approved: true, requestDigest: value.requestDigest, decisionId: text(value.decisionId, 'Promotion decisionId'), decidedBy: text(value.decidedBy, 'Promotion decidedBy'), route: value.route });
}

function capabilitySemantics(pack: CapabilityPack | undefined): Map<string, string> {
  const values = [
    ...(pack?.tools ?? []).map(value => [`tool:${value.id}`, digest(value)] as const),
    ...(pack?.skills ?? []).map(value => [`skill:${value.id}`, digest(value)] as const),
    ...(pack?.agents ?? []).map(value => [`agent:${value.id}`, digest(value)] as const),
    ...(pack?.workflows ?? []).map(value => [`workflow:${value.id}`, digest(value)] as const),
  ];
  return new Map(values);
}

function packRef(pack: CapabilityPack): CapabilityPackRef {
  return deepFreeze({ id: pack.id, version: pack.version, digest: pack.digest });
}

function canonicalPackRef(value: CapabilityPackRef): CapabilityPackRef {
  assertKeys(value, ['id', 'version', 'digest'], 'Promotion Pack ref');
  return deepFreeze({ id: text(value.id, 'Pack id'), version: text(value.version, 'Pack version'), digest: requiredDigest(value.digest, 'Pack digest') });
}

function unique(values: readonly string[]): readonly string[] {
  const result = [...values].map(value => text(value, 'Promotion diff item')).sort();
  if (new Set(result).size !== result.length) throw new Error('Promotion diff contains duplicates');
  return deepFreeze(result);
}

function assertKeys(value: object, expected: readonly string[], label: string): void {
  if (canonicalWorkroomJson(Object.keys(value).sort()) !== canonicalWorkroomJson([...expected].sort())) {
    throw new Error(`${label} keys are invalid`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result.startsWith('sha256:')) throw new Error(`${label} is invalid`);
  return result;
}

function keyHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readOptional(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw new Error('Overlay Pack Promotion record is not valid JSON', { cause: error });
  }
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
