import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';

export type LegacyPayloadSourceKind = 'journal' | 'projection' | 'evidence' | 'artifact';
export type LegacyPayloadStorage = 'file' | 'database';

export interface LegacyPayloadsOfflineCommandOptions {
  readonly input: string;
  readonly output?: string;
  readonly storage: LegacyPayloadStorage;
  readonly sourceKind: LegacyPayloadSourceKind;
}

export type LegacyPayloadsOfflineCommandOutput =
  import('@zhin.js/agent').LegacyEmbeddedPayloadQuarantineAudit;

/** Offline-only scanner. It never constructs a Host, opens a writer, imports, or purges. */
export async function executeLegacyPayloadsOfflineCommand(
  options: LegacyPayloadsOfflineCommandOptions,
): Promise<LegacyPayloadsOfflineCommandOutput> {
  const inputPath = resolve(options.input);
  const outputPath = options.output ? resolve(options.output) : undefined;
  if (outputPath === inputPath) {
    throw new Error('Legacy embedded payload audit must not overwrite its source');
  }
  const sourceKind = requireSourceKind(options.sourceKind);
  const storage = requireStorage(options.storage);
  const agent = await import('@zhin.js/agent');
  let adapter: import('@zhin.js/agent').LegacyEmbeddedPayloadReadAdapter;
  if (storage === 'file') {
    adapter = new agent.FileLegacyEmbeddedPayloadReadAdapter([
      { sourceKind, path: inputPath },
    ]);
  } else {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(`Legacy embedded payload Database export is not readable valid JSON: ${inputPath}`, {
        cause: error,
      });
    }
    assertDatabaseExportSourceKind(value, sourceKind);
    adapter = new agent.DatabaseLegacyEmbeddedPayloadReadAdapter(
      value as import('@zhin.js/agent').LegacyEmbeddedPayloadDatabaseExportV1,
    );
  }
  const report = await agent.scanLegacyEmbeddedPayloads(adapter);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
  } else {
    console.log(serialized.trimEnd());
  }
  return report;
}

export function registerLegacyPayloadsOfflineCommand(agentCommand: Command): void {
  agentCommand
    .command('legacy-payloads <input>')
    .description('Offline read-only quarantine audit of legacy embedded Workroom payloads')
    .requiredOption('--kind <source>', 'journal|projection|evidence|artifact')
    .option('--storage <adapter>', 'file|database explicit export', 'file')
    .option('-o, --output <file>', 'Create a content-free audit/proposal file instead of stdout')
    .action(async (
      input: string,
      options: Readonly<{ kind: string; storage: string; output?: string }>,
    ) => {
      await executeLegacyPayloadsOfflineCommand({
        input,
        sourceKind: requireSourceKind(options.kind),
        storage: requireStorage(options.storage),
        ...(options.output ? { output: options.output } : {}),
      });
    });
}

function assertDatabaseExportSourceKind(value: unknown, expected: LegacyPayloadSourceKind): void {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { rows?: unknown }).rows)) {
    throw new Error('Legacy embedded payload Database export schema is unknown');
  }
  for (const row of (value as { rows: unknown[] }).rows) {
    if (!row || typeof row !== 'object' || (row as { sourceKind?: unknown }).sourceKind !== expected) {
      throw new Error('Legacy embedded payload Database export source mapping is ambiguous');
    }
  }
}

function requireSourceKind(value: unknown): LegacyPayloadSourceKind {
  if (value !== 'journal' && value !== 'projection' && value !== 'evidence' && value !== 'artifact') {
    throw new Error('Legacy embedded payload source kind must be journal|projection|evidence|artifact');
  }
  return value;
}

function requireStorage(value: unknown): LegacyPayloadStorage {
  if (value !== 'file' && value !== 'database') {
    throw new Error('Legacy embedded payload storage must be file|database');
  }
  return value;
}
