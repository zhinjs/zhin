import {
  ActivatableOverlayPackPromotionRepository,
  DatabaseOverlayPackPromotionRepository,
  WORKROOM_OVERLAY_PACK_PROMOTIONS_MODEL,
  defineOverlayPackPromotionDatabaseModel,
  type OverlayPackPromotionDatabase,
  type OverlayPackPromotionDatabaseModel,
} from '../../src/plugin-runtime/database-overlay-pack-promotion-repository.js';
import {
  MemoryOverlayPackPromotionRepository,
  WorkroomOverlayPackPromotionRuntime,
} from '../../src/plugin-runtime/workroom-overlay-pack-promotion.js';
import {
  createCapabilityPackManifest,
  type CapabilityPackPublication,
} from '../../src/plugin-runtime/workroom-profile-authority-runtime.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('Database Overlay Pack Promotion repository', () => {
  it('copies prepared/published stages before atomically publishing the Database writer', async () => {
    const source = new MemoryOverlayPackPromotionRepository();
    await publish(source, 'software');
    await publish(source, 'content');
    const fixture = databaseFixture();
    const target = new DatabaseOverlayPackPromotionRepository(fixture.database, fixture.model);
    const activatable = new ActivatableOverlayPackPromotionRepository();
    expect(() => activatable.read('promotion:software')).toThrow('not active');
    await activatable.activate(target, ['promotion:software', 'promotion:content'], source);
    expect(await activatable.read('promotion:software')).toEqual(await source.read('promotion:software'));
    expect(await activatable.read('promotion:content')).toEqual(await source.read('promotion:content'));
    expect(fixture.isolationLevels).toHaveLength(4);
  });

  it('recovers the exact two-stage record after restart and registers its schema', async () => {
    const fixture = databaseFixture();
    const repository = new DatabaseOverlayPackPromotionRepository(fixture.database, fixture.model);
    const source = new MemoryOverlayPackPromotionRepository();
    await publish(source, 'customer-support');
    const record = await source.read('promotion:customer-support');
    expect(record?.status).toBe('published');
    if (!record || record.status !== 'published') throw new Error('fixture promotion was not published');
    const prepared = await import('../../src/plugin-runtime/workroom-overlay-pack-promotion.js')
      .then(module => module.preparedOverlayPackPromotionRecord(record));
    await repository.prepare(prepared);
    await repository.markPublished(record);
    const restarted = new DatabaseOverlayPackPromotionRepository(fixture.database, fixture.model);
    expect(await restarted.read(record.promotionId)).toEqual(record);
    const define = vi.fn();
    defineOverlayPackPromotionDatabaseModel({ define });
    expect(define).toHaveBeenCalledWith('workroom_overlay_pack_promotions', WORKROOM_OVERLAY_PACK_PROMOTIONS_MODEL);
  });
});

async function publish(repository: MemoryOverlayPackPromotionRepository, projectId: string) {
  const pack = createCapabilityPackManifest({
    id: `${projectId}-pack`, version: '1', kind: 'domain', requires: [], tools: [], skills: [], agents: [], workflows: [],
  });
  const sourceBody = { kind: 'acceptance_record' as const, projectId, sourceId: `acceptance:${projectId}` };
  return await new WorkroomOverlayPackPromotionRuntime({
    generation: 1,
    generationView: { withCurrent: async (_input, use) => await use({
      generation: 1, digest: digest({ generation: 1 }), tools: [], skills: [], agents: [],
    }) },
    repository,
    sourceAuthority: { verify: async () => true },
    publisherPrincipalId: 'trusted:promotion',
    authority: {
      authorize: async request => ({
        approved: true, requestDigest: request.digest, decisionId: `sponsor:${projectId}`,
        decidedBy: `sponsor:${projectId}`, route: 'sponsor',
      }),
      verify: async (request, decision) => request.digest === decision.requestDigest,
    },
    sharedPacks: {
      read: async () => undefined,
      publish: async command => publication(createCapabilityPackManifest(command.pack)),
    },
  }).promote({
    version: 1, generation: 1, operationId: `promote:${projectId}`, promotionId: `promotion:${projectId}`,
    projectId, overlayRevisionId: `overlay:${projectId}:1`, overlayDigest: digest({ projectId, overlay: 1 }),
    ownerPrincipalId: `owner:${projectId}`, sources: [{ ...sourceBody, digest: digest(sourceBody) }],
    checks: [{ id: 'checks', revision: 'checks:1', status: 'passed', digest: digest({ checks: 1 }) }],
    review: { reviewerPrincipalId: `reviewer:${projectId}`, decisionId: `review:${projectId}`, status: 'approved', digest: digest({ projectId, review: 1 }) },
    pack,
  }, new AbortController().signal);
}

function publication(pack: ReturnType<typeof createCapabilityPackManifest>): CapabilityPackPublication {
  const requestBody = {
    version: 1 as const, action: 'publish_pack' as const, operationId: 'db-promotion',
    authenticatedPrincipalId: 'trusted:promotion', candidateDigest: pack.digest,
  };
  const authorityRequest = Object.freeze({ ...requestBody, digest: digest(requestBody) });
  const body = {
    version: 1 as const, pack, authorityRequest,
    governance: {
      approved: true as const, requestDigest: authorityRequest.digest, decisionId: 'publisher:1',
      decidedBy: 'root', authorizedBy: 'trusted_pack_publisher' as const, decidedAt: 1,
    },
  };
  return Object.freeze({ ...body, digest: digest(body) });
}

function databaseFixture() {
  const rows: Record<string, unknown>[] = [];
  const isolationLevels: string[] = [];
  const select = (query: Record<string, unknown>) => rows.filter(row =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const model: OverlayPackPromotionDatabaseModel = { select: () => ({ where: async query => select(query) }) };
  const database: OverlayPackPromotionDatabase = {
    transaction: async (operation, options) => {
      isolationLevels.push(options.isolationLevel);
      return await operation({
        select: () => ({ where: async query => select(query) }),
        insertMany: async (_table, inserted) => {
          if (inserted.some(candidate => rows.some(row => row.id === candidate.id))) {
            throw Object.assign(new Error('unique constraint'), { code: '23505' });
          }
          rows.push(...inserted);
        },
      });
    },
  };
  return { database, model, isolationLevels };
}
