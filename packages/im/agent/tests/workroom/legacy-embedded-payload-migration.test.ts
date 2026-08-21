import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  DatabaseLegacyEmbeddedPayloadReadAdapter,
  FileLegacyEmbeddedPayloadReadAdapter,
  LegacyEmbeddedPayloadDetectedError,
  assertActiveStoreHasNoLegacyEmbeddedPayload,
  openActiveStoreAfterLegacyEmbeddedPayloadGate,
  scanLegacyEmbeddedPayloads,
} from '../../src/workroom/legacy-embedded-payload-migration.js';

describe('legacy embedded Workroom payload migration scanner', () => {
  it('emits only content-free quarantine facts and a proposal-only purge plan for four legacy sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-payloads-'));
    const fixtures = [
      ['journal', { version: 1, events: [{ eventId: 'event:1', payload: {
        taskKey: 'reply', title: 'private support plan', reason: 'customer said 555-0100',
        criteria: [{ description: 'must hide credential' }], subjectRef: 'subject:customer:7',
      } }] }],
      ['projection', { state: { items: { 'projection:1': {
        id: 'projection:1', content: 'private projection body',
      } } } }],
      ['evidence', { ref: 'evidence:1', output: 'raw evidence body', customerId: 'customer-7' }],
      ['artifact', { sourceType: 'artifact-header', sourceRef: 'artifact:1',
        credential: { accessToken: 'token-value-must-never-escape' } }],
    ] as const;
    const entries: Array<{
      sourceKind: 'journal' | 'projection' | 'evidence' | 'artifact';
      path: string;
    }> = [];
    for (const [sourceKind, value] of fixtures) {
      const path = join(root, `${sourceKind}.json`);
      await writeFile(path, JSON.stringify(value));
      entries.push({ sourceKind, path });
    }
    const report = await scanLegacyEmbeddedPayloads(new FileLegacyEmbeddedPayloadReadAdapter(entries));
    expect(report).toMatchObject({
      kind: 'legacy_embedded_payload_quarantine_audit', readOnly: true,
      containsPayload: false, automaticImport: false, automaticPurge: false,
      sourceStorage: ['file'],
    });
    expect(report.findings.map(finding => finding.sourceKind)).toEqual([
      'artifact', 'evidence', 'journal', 'projection',
    ]);
    expect(report.findings.flatMap(finding => finding.categories)).toEqual(expect.arrayContaining([
      'credential', 'embedded_body', 'subject_identifier',
    ]));
    expect(report.plan.every(item => item.authority === 'proposal_only'
      && item.actions.every(action => action.automatic === false))).toBe(true);
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      'customer said 555-0100', 'private projection body', 'raw evidence body',
      'private support plan', 'must hide credential', 'customer-7', 'subject:customer:7',
      'token-value-must-never-escape',
    ]) expect(serialized).not.toContain(forbidden);
  });

  it('supports a versioned explicit DB row mapping and is deterministic after restart', async () => {
    const exported = {
      version: 1 as const,
      kind: 'workroom_legacy_payload_database_export' as const,
      mappingVersion: 1 as const,
      rows: [{
        sourceKind: 'journal' as const,
        recordRef: 'workroom_events:run-1:4',
        json: JSON.stringify({ eventId: 'event:4', payload: { message: 'legacy message' } }),
      }],
    };
    const first = await scanLegacyEmbeddedPayloads(new DatabaseLegacyEmbeddedPayloadReadAdapter(exported));
    const restarted = await scanLegacyEmbeddedPayloads(new DatabaseLegacyEmbeddedPayloadReadAdapter(exported));
    expect(restarted).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('legacy message');
    expect(first.findings[0]).toMatchObject({
      storage: 'database', recordRef: 'workroom_events:run-1:4', categories: ['embedded_body'],
    });
  });

  it('does not quarantine a current content-free Journal reference as legacy text', async () => {
    const current = {
      version: 2,
      events: [{
        version: 2,
        payload: {
          title: {
            version: 1,
            kind: 'governed_workroom_journal_payload',
            fieldPath: '$.payload.title',
            contentHash: `sha256:${'a'.repeat(64)}`,
            receipt: {
              descriptor: {
                vaultObjectId: 'opaque', objectId: 'object', payloadHash: `sha256:${'a'.repeat(64)}`,
                descriptorDigest: `sha256:${'b'.repeat(64)}`,
                locationManifestDigest: `sha256:${'c'.repeat(64)}`, bytes: 7,
              },
              source: {
                kind: 'command', ref: 'event:1', digest: `sha256:${'d'.repeat(64)}`,
                bindingDigest: `sha256:${'e'.repeat(64)}`, verification: 'verified',
              },
            },
          },
        },
      }],
    };
    const report = await scanLegacyEmbeddedPayloads({
      read: async () => [{
        storage: 'file', sourceKind: 'journal', recordRef: 'journal:v2', value: current,
      }],
    });
    expect(report.findings).toEqual([]);
  });

  it('fails closed on corrupt/unknown input without echoing source bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-payloads-corrupt-'));
    const path = join(root, 'projection.json');
    const secret = 'broken-secret-body';
    await writeFile(path, `{${secret}`);
    let failure: unknown;
    try {
      await scanLegacyEmbeddedPayloads(new FileLegacyEmbeddedPayloadReadAdapter([
        { sourceKind: 'projection', path },
      ]));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('corrupt');
    expect((failure as Error).message).not.toContain(secret);
    expect(() => new DatabaseLegacyEmbeddedPayloadReadAdapter({
      ...({} as never), version: 1, kind: 'workroom_legacy_payload_database_export',
      mappingVersion: 2,
    })).toThrow('mapping version');
  });

  it('denies active writer activation with one fixed content-free error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-payloads-active-'));
    await mkdir(join(root, 'reports'));
    await writeFile(join(root, 'reports', 'legacy.json'), JSON.stringify({ content: 'do not print me' }));
    const adapter = new FileLegacyEmbeddedPayloadReadAdapter([
      { sourceKind: 'evidence', path: join(root, 'reports') },
    ]);
    let opened = 0;
    let failure: unknown;
    try {
      await assertActiveStoreHasNoLegacyEmbeddedPayload(adapter);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LegacyEmbeddedPayloadDetectedError);
    expect((failure as Error).message).toBe(
      'Legacy embedded Workroom payload detected; production writer activation denied',
    );
    expect((failure as Error).message).not.toContain('do not print me');
    await expect(openActiveStoreAfterLegacyEmbeddedPayloadGate(adapter, () => {
      opened += 1;
      return Object.freeze({ writer: true });
    })).rejects.toBeInstanceOf(LegacyEmbeddedPayloadDetectedError);
    expect(opened).toBe(0);
  });
});
