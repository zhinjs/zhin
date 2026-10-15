import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { digestCanonicalWorkroomValue as digest } from '../canonical-value.js';

type LegacyEmbeddedPayloadStorage = 'file' | 'database';
type LegacyEmbeddedPayloadCategory = 'embedded_body' | 'subject_identifier' | 'credential';

/** Private guard input. The value is never copied into an error message. */
export interface LegacyEmbeddedPayloadGuardRecord {
  readonly recordRef: string;
  readonly value: unknown;
}

export class LegacyEmbeddedPayloadDetectedError extends Error {
  constructor(
    message = 'Legacy embedded Workroom payload is no longer supported; this store format cannot be read or activated',
  ) {
    super(message);
    this.name = 'LegacyEmbeddedPayloadDetectedError';
  }
}

/**
 * Fail-closed gate: any legacy finding denies reading or activating the store.
 * Every recordRef must be unique; a duplicate is malformed input, not a legacy finding.
 */
export function assertNoLegacyEmbeddedPayloadRecords(
  records: readonly LegacyEmbeddedPayloadGuardRecord[],
): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.recordRef)) {
      throw new Error('Legacy embedded payload journal records contain a duplicate record identity');
    }
    seen.add(record.recordRef);
    if (detect(record.value).length > 0) throw new LegacyEmbeddedPayloadDetectedError();
  }
}

/** Reads Journal segment files read-only. Never follows symlinks. */
export async function assertNoLegacyEmbeddedPayloadFiles(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) throw new Error('Legacy embedded payload File input is empty');
  const records: LegacyEmbeddedPayloadGuardRecord[] = [];
  for (const path of paths) {
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(path);
    } catch (error) {
      throw corrupt('file', safeRef(path), error);
    }
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw corrupt('file', safeRef(path));
    }
    const files = stat.isFile() ? [path] : await directoryFiles(path);
    for (const file of files) {
      const recordRef = `file:journal:${safeRef(file)}`;
      let value: unknown;
      try {
        value = JSON.parse(await readFile(file, 'utf8')) as unknown;
      } catch (error) {
        throw corrupt('file', recordRef, error);
      }
      if (!value || typeof value !== 'object') throw corrupt('file', recordRef);
      records.push({ recordRef, value });
    }
  }
  assertNoLegacyEmbeddedPayloadRecords(records);
}

function detect(value: unknown): readonly string[] {
  const paths = new Set<string>();
  if (isLegacyJournalSchema(value)) paths.add('$.<legacy-journal-schema>');
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
        paths.add(`$.**.${canonicalFieldName(key)}`);
      }
      visit(child);
    }
  };
  visit(value);
  return [...paths].sort();
}

function isLegacyJournalSchema(value: unknown): boolean {
  return Array.isArray(value)
    || (!!value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).version !== 3);
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

async function directoryFiles(directory: string): Promise<readonly string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw corrupt('file', safeRef(directory), error);
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
      throw corrupt('file', `file:journal:${safeRef(join(directory, entry.name))}`);
    }
    files.push(join(directory, entry.name));
  }
  return Object.freeze(files.sort());
}

function safeRef(path: string): string {
  return `path:${digest({ basename: basename(path), path }).slice('sha256:'.length)}`;
}

function corrupt(storage: LegacyEmbeddedPayloadStorage, recordRef: string, cause?: unknown): Error {
  return new Error(`Legacy embedded payload ${storage}/journal record ${recordRef} is corrupt or unknown`,
    cause === undefined ? undefined : { cause });
}
