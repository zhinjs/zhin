import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import * as guard from '../../src/workroom/journal/legacy-payload-guard.js';
import * as workroom from '../../src/index.js';

const {
  LegacyEmbeddedPayloadDetectedError,
  assertNoLegacyEmbeddedPayloadFiles,
  assertNoLegacyEmbeddedPayloadRecords,
} = guard;

const reference = {
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
};

const record = (value: unknown) => [{ recordRef: 'journal:test', value }];

describe('legacy embedded Workroom payload guard', () => {
  it('rejects array and non-v3 journal schemas', () => {
    expect(() => assertNoLegacyEmbeddedPayloadRecords(record([]))).toThrow(LegacyEmbeddedPayloadDetectedError);
    for (const version of [1, 2, 4, undefined]) {
      expect(() => assertNoLegacyEmbeddedPayloadRecords(record({ version, events: [] })))
        .toThrow(LegacyEmbeddedPayloadDetectedError);
    }
    expect(() => assertNoLegacyEmbeddedPayloadRecords(record({ version: 3, events: [] }))).not.toThrow();
  });

  it('rejects plaintext title and credential fields', () => {
    expect(() => assertNoLegacyEmbeddedPayloadRecords(record({
      version: 3, events: [{ payload: { title: 'private plan' } }],
    }))).toThrow(LegacyEmbeddedPayloadDetectedError);
    expect(() => assertNoLegacyEmbeddedPayloadRecords(record({
      version: 3, events: [{ payload: { credential: { accessToken: 'x' } } }],
    }))).toThrow(LegacyEmbeddedPayloadDetectedError);
  });

  it('accepts governed reference objects', () => {
    expect(() => assertNoLegacyEmbeddedPayloadRecords(record({
      version: 3, events: [{ version: 3, payload: { title: reference } }],
    }))).not.toThrow();
  });

  it('rejects symlinks and non-json directory entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-guard-'));
    await writeFile(join(root, 'ok.json'), JSON.stringify({ version: 3, events: [] }));
    await symlink(join(root, 'ok.json'), join(root, 'link.json'));
    await expect(assertNoLegacyEmbeddedPayloadFiles([join(root, 'link.json')]))
      .rejects.toThrow('corrupt');
    const dir = join(root, 'dir');
    await mkdir(dir);
    await writeFile(join(dir, 'a.json'), JSON.stringify({ version: 3, events: [] }));
    await expect(assertNoLegacyEmbeddedPayloadFiles([dir])).resolves.toBeUndefined();
    await writeFile(join(dir, 'notes.txt'), 'x');
    await expect(assertNoLegacyEmbeddedPayloadFiles([dir])).rejects.toThrow('corrupt');
  });

  it('keeps errors content-free', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-guard-secret-'));
    const secret = 'do not print me';
    await writeFile(join(root, 'legacy.json'), JSON.stringify({ version: 3, content: secret }));
    await writeFile(join(root, 'broken.json'), `{${secret}`);
    for (const name of ['legacy.json', 'broken.json']) {
      const failure = await assertNoLegacyEmbeddedPayloadFiles([join(root, name)]).catch(error => error as Error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).not.toContain(secret);
      expect(failure.message).not.toMatch(/migrat|purge|export/u);
    }
    const detected = await assertNoLegacyEmbeddedPayloadFiles([join(root, 'legacy.json')]).catch(error => error as Error);
    expect(detected).toBeInstanceOf(LegacyEmbeddedPayloadDetectedError);
    expect(detected.message).toContain('no longer supported');
  });

  it('exposes no scan, audit or purge capability', () => {
    for (const mod of [guard, workroom] as Array<Record<string, unknown>>) {
      for (const name of Object.keys(mod)) expect(name).not.toMatch(/scanLegacy|LegacyEmbeddedPayload(Audit|Quarantine)|PurgePlan|LegacyRunOffline|buildLegacyRun/iu);
    }
    expect(workroom.LegacyEmbeddedPayloadDetectedError).toBe(LegacyEmbeddedPayloadDetectedError);
  });
});
