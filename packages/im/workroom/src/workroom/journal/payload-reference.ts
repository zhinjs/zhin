import type { WorkroomEvent } from '../kernel-contracts.js';
import { LegacyEmbeddedPayloadDetectedError } from '../legacy-embedded-payload-migration.js';
import type { GovernedWorkroomJournalPayloadReference } from './contracts.js';
import { assertAllowedPayloadKeys, isNonEmptyString, isRecord } from './event-validation.js';

export function isGovernedJournalPayloadReference(value: unknown): value is GovernedWorkroomJournalPayloadReference {
  if (!isRecord(value) || value.version !== 1 || value.kind !== 'governed_workroom_journal_payload'
    || !isNonEmptyString(value.fieldPath) || !isDigest(value.contentHash)
    || !isRecord(value.receipt)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 5
    && ['contentHash', 'fieldPath', 'kind', 'receipt', 'version'].every((key, index) => keys[index] === key);
}

export function validateProtectedPayload(
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
): void {
  assertAllowedPayloadKeys(type, payload);
  const visit = (value: unknown, fieldPath: string): void => {
    if (isGovernedJournalPayloadReference(value)) {
      if (value.fieldPath !== fieldPath) throw new Error('Governed Workroom Journal payload path is invalid');
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${fieldPath}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (!isContentFreeJournalValue(type, `${fieldPath}.${key}`, child) && containsGovernedValue(child)
        && !isGovernedJournalPayloadReference(child)) {
        throw legacyJournalPayloadError();
      }
      visit(child, `${fieldPath}.${key}`);
    }
  };
  visit(payload, '$.payload');
}

export function isContentFreeJournalValue(
  type: WorkroomEvent['type'],
  fieldPath: string,
  value: unknown,
): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return true;
  if (typeof value !== 'string') return false;
  if (type === 'run.created' && fieldPath === '$.payload.projectId') return true;
  return isDigest(value);
}

export function containsGovernedValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== 'object' || Object.keys(value).length > 0;
}

export function legacyJournalPayloadError(): Error {
  return new LegacyEmbeddedPayloadDetectedError(
    'Legacy embedded Workroom Journal payload is quarantined; use offline export/purge verification before activation',
  );
}

export function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}
