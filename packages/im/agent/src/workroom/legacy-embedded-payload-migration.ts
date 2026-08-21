import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

export type LegacyEmbeddedPayloadSourceKind = 'journal' | 'projection' | 'evidence' | 'artifact';
export type LegacyEmbeddedPayloadStorage = 'file' | 'database';
export type LegacyEmbeddedPayloadCategory = 'embedded_body' | 'subject_identifier' | 'credential';

export interface LegacyEmbeddedPayloadRecord {
  readonly storage: LegacyEmbeddedPayloadStorage;
  readonly sourceKind: LegacyEmbeddedPayloadSourceKind;
  readonly recordRef: string;
  /** Private scanner input. It is never copied into an audit or plan. */
  readonly value: unknown;
}

export interface LegacyEmbeddedPayloadReadAdapter {
  read(): Promise<readonly LegacyEmbeddedPayloadRecord[]>;
}

export interface LegacyEmbeddedPayloadFinding {
  readonly version: 1;
  readonly status: 'quarantined';
  readonly storage: LegacyEmbeddedPayloadStorage;
  readonly sourceKind: LegacyEmbeddedPayloadSourceKind;
  readonly recordRef: string;
  readonly recordDigest: string;
  readonly categories: readonly LegacyEmbeddedPayloadCategory[];
  /** Normalized schema paths contain field names, never dynamic keys or values. */
  readonly fieldPaths: readonly string[];
  readonly digest: string;
}

export interface LegacyEmbeddedPayloadPurgePlanItem {
  readonly version: 1;
  readonly authority: 'proposal_only';
  readonly recordRef: string;
  readonly recordDigest: string;
  readonly sourceKind: LegacyEmbeddedPayloadSourceKind;
  readonly actions: readonly Readonly<{
    kind: 'offline_export_header' | 'purge_source_record' | 'verify_absent';
    automatic: false;
  }>[];
  readonly digest: string;
}

export interface LegacyEmbeddedPayloadQuarantineAudit {
  readonly version: 1;
  readonly kind: 'legacy_embedded_payload_quarantine_audit';
  readonly readOnly: true;
  readonly containsPayload: false;
  readonly automaticImport: false;
  readonly automaticPurge: false;
  readonly sourceStorage: readonly LegacyEmbeddedPayloadStorage[];
  readonly scannedRecordCount: number;
  readonly findings: readonly LegacyEmbeddedPayloadFinding[];
  readonly plan: readonly LegacyEmbeddedPayloadPurgePlanItem[];
  readonly digest: string;
}

export interface FileLegacyEmbeddedPayloadInput {
  readonly sourceKind: LegacyEmbeddedPayloadSourceKind;
  readonly path: string;
}

/** Explicit File adapter. It never guesses roots and never follows symlinks. */
export class FileLegacyEmbeddedPayloadReadAdapter implements LegacyEmbeddedPayloadReadAdapter {
  readonly #inputs: readonly FileLegacyEmbeddedPayloadInput[];

  constructor(inputs: readonly FileLegacyEmbeddedPayloadInput[]) {
    if (inputs.length === 0) throw new Error('Legacy embedded payload File input is empty');
    this.#inputs = Object.freeze(inputs.map(input => Object.freeze({
      sourceKind: sourceKind(input.sourceKind),
      path: required(input.path, 'Legacy embedded payload File path'),
    })));
  }

  async read(): Promise<readonly LegacyEmbeddedPayloadRecord[]> {
    const records: LegacyEmbeddedPayloadRecord[] = [];
    for (const input of this.#inputs) {
      let stat: Awaited<ReturnType<typeof lstat>>;
      try {
        stat = await lstat(input.path);
      } catch (error) {
        throw corrupt('file', input.sourceKind, safeRef(input.path), error);
      }
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw corrupt('file', input.sourceKind, safeRef(input.path));
      }
      const files = stat.isFile()
        ? [input.path]
        : await directoryFiles(input.path, input.sourceKind);
      for (const file of files) {
        const recordRef = `file:${input.sourceKind}:${safeRef(file)}`;
        let value: unknown;
        try {
          value = JSON.parse(await readFile(file, 'utf8')) as unknown;
        } catch (error) {
          throw corrupt('file', input.sourceKind, recordRef, error);
        }
        rootValue(value, 'file', input.sourceKind, recordRef);
        records.push(deepFreeze({
          storage: 'file' as const,
          sourceKind: input.sourceKind,
          recordRef,
          value,
        }));
      }
    }
    return canonicalRecords(records);
  }
}

export interface LegacyEmbeddedPayloadDatabaseExportV1 {
  readonly version: 1;
  readonly kind: 'workroom_legacy_payload_database_export';
  readonly mappingVersion: 1;
  readonly rows: readonly Readonly<{
    readonly sourceKind: LegacyEmbeddedPayloadSourceKind;
    readonly recordRef: string;
    /** Explicit read-only row mapping. The scanner never persists or prints it. */
    readonly json: string;
  }>[];
}

/**
 * Offline DB export adapter. `mappingVersion` is mandatory so unknown table/
 * column mappings cannot silently be interpreted as a current schema.
 */
export class DatabaseLegacyEmbeddedPayloadReadAdapter implements LegacyEmbeddedPayloadReadAdapter {
  readonly #input: LegacyEmbeddedPayloadDatabaseExportV1;

  constructor(input: LegacyEmbeddedPayloadDatabaseExportV1) {
    if (!input || typeof input !== 'object'
      || input.version !== 1 || input.kind !== 'workroom_legacy_payload_database_export'
      || input.mappingVersion !== 1) {
      throw new Error('Legacy embedded payload Database mapping version is unknown');
    }
    exactKeys(input, ['version', 'kind', 'mappingVersion', 'rows'], 'Database export');
    if (!Array.isArray(input.rows)) throw new Error('Legacy embedded payload Database rows are invalid');
    this.#input = input;
  }

  async read(): Promise<readonly LegacyEmbeddedPayloadRecord[]> {
    const records = this.#input.rows.map((row, index) => {
      if (!row || typeof row !== 'object') {
        throw new Error(`Legacy embedded payload Database row ${index} schema is unknown`);
      }
      exactKeys(row, ['sourceKind', 'recordRef', 'json'], `Database row ${index}`);
      const kind = sourceKind(row.sourceKind);
      const recordRef = required(row.recordRef, `Database row ${index} recordRef`);
      if (typeof row.json !== 'string') throw corrupt('database', kind, recordRef);
      let value: unknown;
      try {
        value = JSON.parse(row.json) as unknown;
      } catch (error) {
        throw corrupt('database', kind, recordRef, error);
      }
      rootValue(value, 'database', kind, recordRef);
      return deepFreeze({ storage: 'database' as const, sourceKind: kind, recordRef, value });
    });
    return canonicalRecords(records);
  }
}

export async function scanLegacyEmbeddedPayloads(
  adapter: LegacyEmbeddedPayloadReadAdapter,
): Promise<LegacyEmbeddedPayloadQuarantineAudit> {
  const records = await adapter.read();
  const findings = records.flatMap(record => {
    const detected = detect(record.value, record.sourceKind);
    if (detected.paths.length === 0) return [];
    const findingBody = deepFreeze({
      version: 1 as const,
      status: 'quarantined' as const,
      storage: record.storage,
      sourceKind: record.sourceKind,
      recordRef: record.recordRef,
      recordDigest: digest(record.value),
      categories: detected.categories,
      fieldPaths: detected.paths,
    });
    return [deepFreeze({ ...findingBody, digest: digest(findingBody) })];
  }).sort(compareFindings);
  const plan = findings.map(finding => {
    const body = deepFreeze({
      version: 1 as const,
      authority: 'proposal_only' as const,
      recordRef: finding.recordRef,
      recordDigest: finding.recordDigest,
      sourceKind: finding.sourceKind,
      actions: Object.freeze([
        Object.freeze({ kind: 'offline_export_header' as const, automatic: false as const }),
        Object.freeze({ kind: 'purge_source_record' as const, automatic: false as const }),
        Object.freeze({ kind: 'verify_absent' as const, automatic: false as const }),
      ]),
    });
    return deepFreeze({ ...body, digest: digest(body) });
  });
  const body = deepFreeze({
    version: 1 as const,
    kind: 'legacy_embedded_payload_quarantine_audit' as const,
    readOnly: true as const,
    containsPayload: false as const,
    automaticImport: false as const,
    automaticPurge: false as const,
    sourceStorage: unique(records.map(record => record.storage)),
    scannedRecordCount: records.length,
    findings,
    plan,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export class LegacyEmbeddedPayloadDetectedError extends Error {
  constructor(
    message = 'Legacy embedded Workroom payload detected; production writer activation denied',
  ) {
    super(message);
    this.name = 'LegacyEmbeddedPayloadDetectedError';
  }
}

/** Must run before an active production writer is opened. */
export async function assertActiveStoreHasNoLegacyEmbeddedPayload(
  adapter: LegacyEmbeddedPayloadReadAdapter,
): Promise<void> {
  const report = await scanLegacyEmbeddedPayloads(adapter);
  if (report.findings.length > 0) throw new LegacyEmbeddedPayloadDetectedError();
}

/** The writer factory is unreachable until the complete read-only scan passes. */
export async function openActiveStoreAfterLegacyEmbeddedPayloadGate<T>(
  adapter: LegacyEmbeddedPayloadReadAdapter,
  openWriter: () => T | Promise<T>,
): Promise<T> {
  await assertActiveStoreHasNoLegacyEmbeddedPayload(adapter);
  return await openWriter();
}

function detect(value: unknown, sourceKind: LegacyEmbeddedPayloadSourceKind): Readonly<{
  categories: readonly LegacyEmbeddedPayloadCategory[];
  paths: readonly string[];
}> {
  const categories = new Set<LegacyEmbeddedPayloadCategory>();
  const paths = new Set<string>();
  if (sourceKind === 'journal' && isLegacyJournalSchema(value)) {
    categories.add('embedded_body');
    paths.add('$.<legacy-journal-schema>');
  }
  const visit = (candidate: unknown): void => {
    if (isGovernedJournalReference(candidate)) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [key, child] of Object.entries(candidate)) {
      const category = fieldCategory(key);
      if (category && !isGovernedJournalReference(child) && containsValue(child)) {
        categories.add(category);
        paths.add(`$.**.${canonicalFieldName(key)}`);
      }
      visit(child);
    }
  };
  visit(value);
  return deepFreeze({
    categories: [...categories].sort(),
    paths: [...paths].sort(),
  });
}

function isLegacyJournalSchema(value: unknown): boolean {
  return Array.isArray(value)
    || (!!value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).version === 1);
}

function isGovernedJournalReference(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(',') !== 'contentHash,fieldPath,kind,receipt,version'
    || !candidate.receipt || typeof candidate.receipt !== 'object' || Array.isArray(candidate.receipt)) return false;
  const receipt = candidate.receipt as Record<string, unknown>;
  if (Object.keys(receipt).sort().join(',') !== 'descriptor,source'
    || !receipt.descriptor || typeof receipt.descriptor !== 'object' || Array.isArray(receipt.descriptor)
    || !receipt.source || typeof receipt.source !== 'object' || Array.isArray(receipt.source)) return false;
  const descriptor = receipt.descriptor as Record<string, unknown>;
  const source = receipt.source as Record<string, unknown>;
  return candidate.version === 1
    && candidate.kind === 'governed_workroom_journal_payload'
    && typeof candidate.fieldPath === 'string'
    && isSha256(candidate.contentHash)
    && Object.keys(descriptor).sort().join(',')
      === 'bytes,descriptorDigest,locationManifestDigest,objectId,payloadHash,vaultObjectId'
    && typeof descriptor.vaultObjectId === 'string'
    && typeof descriptor.objectId === 'string'
    && descriptor.payloadHash === candidate.contentHash
    && isSha256(descriptor.descriptorDigest)
    && isSha256(descriptor.locationManifestDigest)
    && Number.isSafeInteger(descriptor.bytes)
    && Object.keys(source).sort().join(',') === 'bindingDigest,digest,kind,ref,verification'
    && source.kind === 'command'
    && typeof source.ref === 'string'
    && isSha256(source.digest)
    && isSha256(source.bindingDigest)
    && source.verification === 'verified';
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function fieldCategory(key: string): LegacyEmbeddedPayloadCategory | undefined {
  const canonical = canonicalFieldName(key);
  if (/^(?:credential|credentials|token|accesstoken|refreshtoken|apikey|password|secret|privatekey|authorization|cookie)$/u
    .test(canonical)) return 'credential';
  if (/^(?:subject|subjectref|subjectrefs|userid|customerid|accountid|email|phone|address|directidentifier)$/u
    .test(canonical)) return 'subject_identifier';
  if (/^(?:acceptancecontract|arguments|body|candidate|checkresults|content|contract|criteria|description|message|metadata|output|parameters|plaintext|plan|progress|prompt|raw|reason|record|result|resultsummary|riskassessment|summary|text|title|toolargs|transcript)$/u
    .test(canonical)) return 'embedded_body';
  return undefined;
}

function canonicalFieldName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function containsValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

async function directoryFiles(
  directory: string,
  kind: LegacyEmbeddedPayloadSourceKind,
): Promise<readonly string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw corrupt('file', kind, safeRef(directory), error);
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
      throw corrupt('file', kind, `file:${kind}:${safeRef(join(directory, entry.name))}`);
    }
    files.push(join(directory, entry.name));
  }
  return Object.freeze(files.sort());
}

function canonicalRecords(
  values: readonly LegacyEmbeddedPayloadRecord[],
): readonly LegacyEmbeddedPayloadRecord[] {
  const records = [...values].sort((left, right) => `${left.sourceKind}:${left.recordRef}`
    .localeCompare(`${right.sourceKind}:${right.recordRef}`));
  const identities = records.map(record => `${record.storage}:${record.sourceKind}:${record.recordRef}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error('Legacy embedded payload adapter contains duplicate record identity');
  }
  return Object.freeze(records);
}

function compareFindings(left: LegacyEmbeddedPayloadFinding, right: LegacyEmbeddedPayloadFinding): number {
  return `${left.sourceKind}:${left.recordRef}`.localeCompare(`${right.sourceKind}:${right.recordRef}`);
}

function sourceKind(value: unknown): LegacyEmbeddedPayloadSourceKind {
  if (value !== 'journal' && value !== 'projection' && value !== 'evidence' && value !== 'artifact') {
    throw new Error('Legacy embedded payload source kind is unknown');
  }
  return value;
}

function rootValue(
  value: unknown,
  storage: LegacyEmbeddedPayloadStorage,
  kind: LegacyEmbeddedPayloadSourceKind,
  recordRef: string,
): void {
  if (!value || typeof value !== 'object') throw corrupt(storage, kind, recordRef);
}

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || [...expected].sort().some((key, index) => keys[index] !== key)) {
    throw new Error(`Legacy embedded payload ${label} schema is unknown`);
  }
}

function safeRef(path: string): string {
  return `path:${digest({ basename: basename(path), path }).slice('sha256:'.length)}`;
}

function corrupt(
  storage: LegacyEmbeddedPayloadStorage,
  kind: LegacyEmbeddedPayloadSourceKind,
  recordRef: string,
  cause?: unknown,
): Error {
  return new Error(`Legacy embedded payload ${storage}/${kind} record ${recordRef} is corrupt or unknown`,
    cause === undefined ? undefined : { cause });
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort());
}
