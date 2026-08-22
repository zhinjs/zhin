import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeLegacyPayloadsOfflineCommand } from '../src/commands/agent-legacy-payloads.js';

describe('zhin agent legacy-payloads', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes a create-only content-free File audit without printing the embedded body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-payload-cli-'));
    const input = join(root, 'projection.json');
    const output = join(root, 'audit.json');
    const secret = 'customer-private-body-never-print';
    await writeFile(input, JSON.stringify({ state: { items: { one: { content: secret } } } }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const report = await executeLegacyPayloadsOfflineCommand({
      input, output, storage: 'file', sourceKind: 'projection',
    });
    expect(report.findings).toHaveLength(1);
    const serialized = await readFile(output, 'utf8');
    expect(serialized).not.toContain(secret);
    expect(log).not.toHaveBeenCalled();
    await expect(executeLegacyPayloadsOfflineCommand({
      input, output, storage: 'file', sourceKind: 'projection',
    })).rejects.toThrow();
  }, 30_000);

  it('reads only a versioned explicit DB export and stdout remains content-free', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-payload-db-cli-'));
    const input = join(root, 'rows.json');
    const secret = 'credential-value-never-print';
    await writeFile(input, JSON.stringify({
      version: 1, kind: 'workroom_legacy_payload_database_export', mappingVersion: 1,
      rows: [{ sourceKind: 'artifact', recordRef: 'risk-header:artifact:1',
        json: JSON.stringify({ sourceType: 'artifact-header', token: secret }) }],
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const report = await executeLegacyPayloadsOfflineCommand({
      input, storage: 'database', sourceKind: 'artifact',
    });
    expect(report.findings[0]?.categories).toEqual(['credential']);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).not.toContain(secret);
  });

  it('rejects source overwrite and invalid/ambiguous mapping without exposing bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-payload-invalid-cli-'));
    const input = join(root, 'input.json');
    await writeFile(input, JSON.stringify({ content: 'hidden' }));
    await expect(executeLegacyPayloadsOfflineCommand({
      input, output: input, storage: 'file', sourceKind: 'evidence',
    })).rejects.toThrow('must not overwrite');
    await expect(executeLegacyPayloadsOfflineCommand({
      input, storage: 'database', sourceKind: 'journal',
    })).rejects.toThrow(/mapping|schema|version/iu);
  });
});
