import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  createGenerationWorkroomEphemeralAssignmentContext,
  createCatalogProjectKnowledgeSourceAuthority,
  createP12WorkroomKnowledgeContentReader,
} from '../../src/plugin-runtime/workroom-assignment-knowledge-composition.js';

const SHA = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

describe('standard Assignment Knowledge composition', () => {
  it('reauthorizes an exact P12 source and keeps the body only in the generation context', async () => {
    const body = new TextEncoder().encode('{"term":"redacted"}');
    const manifest = {
      requestDigest: SHA('request'), digest: SHA('manifest'),
      source: { objectId: 'knowledge:1', payloadHash: SHA('{"term":"redacted"}') },
      output: { mode: 'full' },
      principal: { principalId: 'executor:1', assignmentId: 'assignment:1' },
    } as never;
    const materialize = vi.fn(async () => manifest);
    const revalidate = vi.fn(async () => ({ status: 'ready' as const, manifest, body }));
    const controller = new AbortController();
    const reader = createP12WorkroomKnowledgeContentReader({
      governance: { materialize, revalidate, prepareProjection: vi.fn() } as never,
      signal: controller.signal,
    });
    const result = await reader.read({
      purpose: 'assignment-context', projectId: 'support', assignmentId: 'assignment:1',
      principalId: 'executor:1', taskKey: 'reply', role: 'executor', profileRevisionId: 'profile:1',
      profileDigest: SHA('profile'), knowledgeRevision: 2,
      handle: {
        knowledgeId: 'glossary:pii', kind: 'glossary',
        governedContent: { ref: 'knowledge:1', digest: SHA('{"term":"redacted"}') },
        schema: { ref: 'schema:1', digest: SHA('schema') }, sensitivity: 'high', entryDigest: SHA('entry'),
      },
      projectionDigest: SHA('projection'),
    });
    expect(result?.body).toEqual({ term: 'redacted' });
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      sourceRef: 'knowledge:1', sinkRuleId: 'assignment-context', assignmentId: 'assignment:1',
    }), controller.signal);
    expect(revalidate).toHaveBeenCalledOnce();

    const contexts = createGenerationWorkroomEphemeralAssignmentContext({
      generation: 7, signal: controller.signal,
    });
    const published = await contexts.publish({
      assignmentId: 'assignment:1', principalId: 'executor:1',
      projection: {
        version: 1, projectId: 'support', runId: 'run:1', taskKey: 'reply', role: 'executor',
        profileRevisionId: 'profile:1', profileDigest: SHA('profile'), knowledgeRevision: 2,
        handles: [], digest: SHA('projection'),
      },
      contents: [{ knowledgeId: 'glossary:pii', body: result?.body, contentDigest: SHA('{"term":"redacted"}'),
        authorizationDigest: result!.authorizationDigest }],
      expectedHash: SHA('context'),
    });
    expect(contexts.read(published.ref, published.hash)?.body).toEqual(expect.objectContaining({
      contents: [expect.objectContaining({ body: { term: 'redacted' } })],
    }));
    const unrelated = await contexts.publish({
      assignmentId: 'assignment:2', principalId: 'executor:2',
      projection: {
        version: 1, projectId: 'support', runId: 'run:2', taskKey: 'follow-up', role: 'executor',
        profileRevisionId: 'profile:1', profileDigest: SHA('profile'), knowledgeRevision: 2,
        handles: [], digest: SHA('unrelated-projection'),
      },
      contents: [], expectedHash: SHA('unrelated-context'),
    });
    const released = contexts.releaseTask({
      projectId: 'support', runId: 'run:1', taskKey: 'reply',
    });
    expect(released).toMatchObject({ released: 1, status: 'released' });
    expect(contexts.read(published.ref, published.hash)).toBeUndefined();
    expect(contexts.read(unrelated.ref, unrelated.hash)).toBeDefined();
    controller.abort();
    expect(contexts.read(unrelated.ref, unrelated.hash)).toBeUndefined();
  });

  it('fails closed when P12 returns a mismatched or denied manifest', async () => {
    const controller = new AbortController();
    const reader = createP12WorkroomKnowledgeContentReader({
      governance: {
        materialize: vi.fn(async () => null), revalidate: vi.fn(), prepareProjection: vi.fn(),
      } as never,
      signal: controller.signal,
    });
    await expect(reader.read({
      purpose: 'assignment-context', projectId: 'project', assignmentId: 'assignment', principalId: 'executor',
      taskKey: 'task', role: 'executor', profileRevisionId: 'profile', profileDigest: SHA('profile'),
      knowledgeRevision: 0, projectionDigest: SHA('projection'),
      handle: { knowledgeId: 'memory', kind: 'memory', governedContent: { ref: 'ref', digest: SHA('body') },
        schema: { ref: 'schema', digest: SHA('schema') }, sensitivity: 'standard', entryDigest: SHA('entry') },
    })).resolves.toBeUndefined();
  });

  it('persists exact Catalog Sponsor authority across a Host restart', async () => {
    const directory = join(await mkdtemp(join(tmpdir(), 'zhin-knowledge-authority-')), 'authority');
    const catalog = {
      read: vi.fn(async () => ({
        revision: SHA('catalog'),
        definitions: { alpha: { enabled: true, sponsors: ['human:alice'] } },
      })),
    };
    const first = createCatalogProjectKnowledgeSourceAuthority({ catalog: catalog as never, directory });
    const source = await first.issueSponsorDecision({
      operationId: 'knowledge:1', projectId: 'alpha', principalId: 'human:alice',
    });
    const restarted = createCatalogProjectKnowledgeSourceAuthority({
      catalog: { read: vi.fn(async () => ({ revision: SHA('later'), definitions: {} })) } as never,
      directory,
    });
    await expect(restarted.verify(source)).resolves.toBe(true);
    await expect(first.issueSponsorDecision({
      operationId: 'knowledge:2', projectId: 'alpha', principalId: 'human:mallory',
    })).rejects.toThrow('current Catalog Sponsor');
  });
});
