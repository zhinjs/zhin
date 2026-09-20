import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OwnerApprovalAddress } from './owner-approval-contracts.js';

const STORE_VERSION = 2 as const;

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
  ): { ok: true; id: string } | { ok: false; error: string } {
    const trimmed = pattern.trim();
    if (!trimmed) return { ok: false, error: '正则不能为空。' };
    try {
      new RegExp(trimmed);
    } catch (error) {
      return { ok: false, error: `无效正则: ${error instanceof Error ? error.message : String(error)}` };
    }
    const document = this.#read();
    const key = addressKey(address);
    const previous = document.endpoints[key] ?? { bashRules: [] };
    const id = crypto.randomUUID();
    this.#write({
      version: STORE_VERSION,
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
  ): { ok: true } | { ok: false; error: string } {
    const id = ruleId.trim();
    if (!id) return { ok: false, error: '请提供规则 id。' };
    const document = this.#read();
    const key = addressKey(address);
    const entry = document.endpoints[key];
    if (!entry?.bashRules.length) return { ok: false, error: '当前无自定义规则。' };
    const next = entry.bashRules.filter((rule) => rule.id !== id && !rule.id.startsWith(id));
    if (next.length === entry.bashRules.length) {
      return { ok: false, error: `未找到 id 前缀或全名为「${id}」的规则。` };
    }
    this.#write({
      version: STORE_VERSION,
      endpoints: {
        ...document.endpoints,
        [key]: { ...entry, bashRules: next },
      },
    });
    return { ok: true };
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
  return `${address.platform}|${address.endpoint}|${address.ownerId}`;
}

function emptyDocument(): OwnerApprovalDocument {
  return { version: STORE_VERSION, endpoints: {} };
}

function parseDocument(input: unknown): OwnerApprovalDocument {
  if (!isRecord(input) || !hasExactKeys(input, ['version', 'endpoints'])) {
    throw new TypeError('Invalid Owner approval document');
  }
  if (input.version !== STORE_VERSION || !isRecord(input.endpoints)) {
    throw new TypeError('Unsupported Owner approval document version');
  }
  const endpoints: Record<string, BashApprovalEntry> = {};
  for (const [key, rawEntry] of Object.entries(input.endpoints)) {
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
  return Object.freeze({ version: STORE_VERSION, endpoints: Object.freeze(endpoints) });
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
