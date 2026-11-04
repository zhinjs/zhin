import type { DataMigrationInventory, Locale } from '@zhin.js/plugin-runtime';
import { ownerApprovalMessages as t } from './owner-approval-messages.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OwnerApprovalAddress } from './owner-approval-contracts.js';

const STORE_VERSION = 3 as const;

export interface BashRuleEntry {
  readonly id: string;
  readonly pattern: string;
  readonly createdAt: number;
}

export interface BashApprovalEntry {
  readonly bashAlways?: boolean;
  readonly bashRules: readonly BashRuleEntry[];
}

interface OwnerApprovalDocument {
  readonly version: typeof STORE_VERSION;
  readonly endpoints: Readonly<Record<string, BashApprovalEntry>>;
  /** V2 alias-keyed grants stay readonly until a fresh grant through the current policy flow. */
  readonly legacyEndpoints: Readonly<Record<string, BashApprovalEntry>>;
}

export class OwnerApprovalStore {
  constructor(private readonly filePath: string) {}

  entry(address: OwnerApprovalAddress): BashApprovalEntry | undefined {
    return this.#read().endpoints[addressKey(address)];
  }

  setBashAlways(address: OwnerApprovalAddress, value: boolean): void {
    const document = this.#read();
    const key = addressKey(address);
    const previous = document.endpoints[key] ?? { bashRules: [] };
    this.#write({
      version: STORE_VERSION,
      legacyEndpoints: document.legacyEndpoints,
      endpoints: {
        ...document.endpoints,
        [key]: {
          ...(value ? { bashAlways: true } : {}),
          bashRules: [...previous.bashRules],
        },
      },
    });
  }

  addBashRule(
    address: OwnerApprovalAddress,
    pattern: string,
    locale?: Locale,
  ): { ok: true; id: string } | { ok: false; error: string } {
    const trimmed = pattern.trim();
    if (!trimmed) return { ok: false, error: t(locale, 'emptyPattern') };
    try {
      new RegExp(trimmed);
    } catch (error) {
      return { ok: false, error: t(locale, 'invalidPattern', { error: error instanceof Error ? error.message : String(error) }) };
    }
    const document = this.#read();
    const key = addressKey(address);
    const previous = document.endpoints[key] ?? { bashRules: [] };
    const id = crypto.randomUUID();
    this.#write({
      version: STORE_VERSION,
      legacyEndpoints: document.legacyEndpoints,
      endpoints: {
        ...document.endpoints,
        [key]: {
          ...(previous.bashAlways ? { bashAlways: true } : {}),
          bashRules: [...previous.bashRules, { id, pattern: trimmed, createdAt: Date.now() }],
        },
      },
    });
    return { ok: true, id };
  }

  removeBashRule(
    address: OwnerApprovalAddress,
    ruleId: string,
    locale?: Locale,
  ): { ok: true } | { ok: false; error: string } {
    const id = ruleId.trim();
    if (!id) return { ok: false, error: t(locale, 'emptyId') };
    const document = this.#read();
    const key = addressKey(address);
    const entry = document.endpoints[key];
    if (!entry?.bashRules.length) return { ok: false, error: t(locale, 'noRules') };
    const next = entry.bashRules.filter((rule) => rule.id !== id && !rule.id.startsWith(id));
    if (next.length === entry.bashRules.length) {
      return { ok: false, error: t(locale, 'missingId', { id }) };
    }
    this.#write({
      version: STORE_VERSION,
      legacyEndpoints: document.legacyEndpoints,
      endpoints: {
        ...document.endpoints,
        [key]: { ...entry, bashRules: next },
      },
    });
    return { ok: true };
  }

  previewHistoricalApprovals(): DataMigrationInventory {
    const entries = Object.entries(this.#read().legacyEndpoints);
    return { revision: digest(entries), candidates: entries.map(([key, entry]) => ({
      id: digest(key), domain: 'owner-approvals', title: 'Historical Owner approval', sourceVersion: '2',
      recordCount: 1, beforeDigest: digest([key, entry]), status: 'unresolved' as const, executable: false,
      summary: { historicalAddress: key, bashAlways: entry.bashAlways === true, ruleCount: entry.bashRules.length,
        requiresFreshAuthorization: true },
    })) };
  }

  #read(): OwnerApprovalDocument {
    try {
      const source = fs.readFileSync(this.filePath, 'utf-8');
      return parseDocument(JSON.parse(source));
    } catch (error) {
      if (isMissingFileError(error)) return emptyDocument();
      throw new OwnerApprovalStoreFormatError(this.filePath, error);
    }
  }

  #write(document: OwnerApprovalDocument): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    fs.renameSync(temporary, this.filePath);
  }
}

export class OwnerApprovalStoreFormatError extends Error {
  constructor(filePath: string, options?: unknown) {
    super(`Owner approval store is invalid: ${filePath}`, { cause: options });
    this.name = 'OwnerApprovalStoreFormatError';
  }
}

function addressKey(address: OwnerApprovalAddress): string {
  return JSON.stringify([address.endpoint.adapter, address.endpoint.id, address.ownerId]);
}

function emptyDocument(): OwnerApprovalDocument {
  return { version: STORE_VERSION, endpoints: {}, legacyEndpoints: {} };
}

function parseDocument(input: unknown): OwnerApprovalDocument {
  if (!isRecord(input) || !hasExactKeys(input, ['version', 'endpoints'], ['legacyEndpoints'])) {
    throw new TypeError('Invalid Owner approval document');
  }
  if ((input.version !== STORE_VERSION && input.version !== 2) || !isRecord(input.endpoints)) {
    throw new TypeError('Unsupported Owner approval document version');
  }
  const parseEntries = (raw: unknown): Readonly<Record<string, BashApprovalEntry>> => {
    if (!isRecord(raw)) throw new TypeError('Invalid Owner approval entries');
    const endpoints: Record<string, BashApprovalEntry> = {};
    for (const [key, rawEntry] of Object.entries(raw)) {
      if (!isRecord(rawEntry) || !hasExactKeys(rawEntry, ['bashRules'], ['bashAlways'])) {
        throw new TypeError(`Invalid Owner approval entry: ${key}`);
      }
      if (rawEntry.bashAlways !== undefined && rawEntry.bashAlways !== true) {
        throw new TypeError(`Invalid bashAlways value: ${key}`);
      }
      if (!Array.isArray(rawEntry.bashRules)) {
        throw new TypeError(`Invalid bashRules value: ${key}`);
      }
      const bashRules = rawEntry.bashRules.map((rule) => parseRule(key, rule));
      endpoints[key] = Object.freeze({
        ...(rawEntry.bashAlways ? { bashAlways: true } : {}),
        bashRules: Object.freeze(bashRules),
      });
    }
    return Object.freeze(endpoints);
  };
  if (input.version === 2 && Object.hasOwn(input, 'legacyEndpoints')) throw new TypeError('Unexpected V2 legacy entries');
  if (input.version === 2) return Object.freeze({ version: STORE_VERSION, endpoints: Object.freeze({}),
    legacyEndpoints: parseEntries(input.endpoints) });
  return Object.freeze({ version: STORE_VERSION, endpoints: parseEntries(input.endpoints),
    legacyEndpoints: parseEntries(input.legacyEndpoints) });
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseRule(endpoint: string, input: unknown): BashRuleEntry {
  if (!isRecord(input) || !hasExactKeys(input, ['id', 'pattern', 'createdAt'])) {
    throw new TypeError(`Invalid Owner approval rule: ${endpoint}`);
  }
  if (typeof input.id !== 'string' || typeof input.pattern !== 'string'
    || typeof input.createdAt !== 'number' || !Number.isFinite(input.createdAt)) {
    throw new TypeError(`Invalid Owner approval rule fields: ${endpoint}`);
  }
  new RegExp(input.pattern);
  return Object.freeze({ id: input.id, pattern: input.pattern, createdAt: input.createdAt });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
