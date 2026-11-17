/**
 * Sandbox media store (ADR 0064 D12, revised 2026-11-17; stage I1).
 *
 * Layout under the project's `.zhin/sandbox/media/` (the Agent's file and shell policies deny
 * `.zhin/` and name `.zhin/sandbox/` explicitly):
 * - `secret`: signing keys `{ current, previous? }`, mode 0600. Links are issued with `current`
 *   and verified against both; `rotate()` keeps the old key as `previous`, `revokeAll()` rotates
 *   and drops it, which voids every link issued before.
 * - `<SHA-256(endpoint id) first 16 hex>/<id>` (bytes) and `<id>.json` (metadata). `id` is 16
 *   random bytes in base64url. The uploader's file name only ever goes into the metadata; nothing
 *   on disk is named after anything a client sent, and lookups take an id that must match
 *   {@link SANDBOX_MEDIA_ID_PATTERN}, never a path.
 *
 * Every object records the conversation it was uploaded in (endpoint + scene) and its uploader;
 * {@link SandboxMediaStore.authorize} refuses another conversation or uploader. Quotas are counted
 * per uploader and per endpoint and are never met by evicting someone else's objects: an upload
 * over either quota is refused.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync, closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  SANDBOX_MEDIA_HARD_MAX_FILE_BYTES,
  type ResolvedSandboxMediaConfig,
  type SandboxMediaKind,
} from './media-config.js';
import {
  SANDBOX_MEDIA_ID_PATTERN,
  SANDBOX_MEDIA_PUBLIC_PREFIX,
  parseSandboxMediaUrl,
} from './media-url.js';

export type SandboxMediaSceneType = 'private' | 'group' | 'channel';

/** The conversation an object belongs to: this endpoint plus the scene the page uploaded in. */
export interface SandboxMediaConversation {
  readonly endpoint: string;
  readonly type: SandboxMediaSceneType;
  readonly id: string;
}

export interface SandboxMediaMeta {
  readonly version: 1;
  readonly id: string;
  readonly kind: SandboxMediaKind;
  /** Sniffed from the bytes, never taken from the request. */
  readonly mime: string;
  readonly size: number;
  readonly name?: string;
  readonly sha256: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** `auditActor` of the Console principal that uploaded it (`user:<id>`, `api-token:<id>`, `bootstrap`). */
  readonly uploader: string;
  readonly conversation: SandboxMediaConversation;
  /** `inline` only for image / audio / video; everything else (SVG and HTML included) downloads. */
  readonly disposition: 'inline' | 'attachment';
}

export type SandboxMediaErrorCode =
  | 'length_required' | 'too_large' | 'length_mismatch' | 'empty' | 'quota_exceeded' | 'uploader_quota_exceeded'
  | 'invalid_name' | 'invalid_conversation' | 'aborted';

export class SandboxMediaError extends Error {
  constructor(readonly code: SandboxMediaErrorCode, readonly status: number, message: string) {
    super(message);
    this.name = 'SandboxMediaError';
  }
}

export type SandboxMediaVerification =
  | Readonly<{ ok: true; meta: SandboxMediaMeta }>
  | Readonly<{ ok: false; reason: 'format' | 'signature' | 'expired' | 'missing' }>;

export type SandboxMediaAuthorization =
  | Readonly<{ ok: true; meta: SandboxMediaMeta }>
  | Readonly<{ ok: false; reason: 'format' | 'signature' | 'expired' | 'missing' | 'conversation_mismatch' | 'uploader_mismatch' }>;

export interface SandboxMediaStoreOptions {
  /** `<project>/.zhin/sandbox/media`. */
  readonly root: string;
  readonly endpointId: string;
  readonly config: ResolvedSandboxMediaConfig;
  readonly now?: () => number;
}

export interface SandboxMediaPutInput {
  readonly body: ReadableStream<Uint8Array> | null;
  /** `Content-Length`; required (411 without it). */
  readonly declaredLength: number | undefined;
  /** `Content-Type` as sent: only picks the provisional size limit, the stored type is sniffed. */
  readonly declaredType?: string;
  readonly fileName?: string;
  readonly conversation: SandboxMediaConversation;
  readonly uploader: string;
  readonly signal?: AbortSignal;
}

const SNIFF_BYTES = 4096;

/** `<SHA-256(endpoint id)>` first 16 hex characters: the endpoint's directory and the address's `dir`. */
export function sandboxMediaDirKey(endpointId: string): string {
  return createHash('sha256').update(endpointId).digest('hex').slice(0, 16);
}

/**
 * Magic numbers, in the same order and with the same results as the Agent's `sniffMedia`
 * (`packages/im/agent/src/media/media-normalize.ts`; a test compares both on one sample set).
 * Before the generic text rule, SVG and HTML are told apart: they are stored as `file` and always
 * downloaded, never shown inline.
 */
export function sniffSandboxMedia(head: Uint8Array): { readonly kind: SandboxMediaKind; readonly mime: string } {
  const buffer = Buffer.from(head.buffer, head.byteOffset, Math.min(head.byteLength, SNIFF_BYTES));
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  const ascii = buffer.subarray(0, 16).toString('ascii');
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return { kind: 'image', mime: 'image/gif' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return { kind: 'audio', mime: 'audio/wav' };
  if (ascii.startsWith('OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii.startsWith('ID3') || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return { kind: 'video', mime: 'video/mp4' };
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind: 'video', mime: 'video/webm' };
  if (ascii.startsWith('%PDF-')) return { kind: 'file', mime: 'application/pdf' };
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return { kind: 'file', mime: 'application/zip' };
  if (buffer.length > 0 && !buffer.includes(0)) {
    const decoded = buffer.toString('utf8');
    const replacementRatio = [...decoded].filter(char => char === '�').length / Math.max(decoded.length, 1);
    if (replacementRatio < 0.01) {
      // Markup a browser would execute: never inline, whatever the uploader declared.
      const start = decoded.replace(/^\uFEFF/u, '').trimStart().slice(0, 1024).toLowerCase();
      if (/<svg[\s>]/u.test(start) && (start.startsWith('<svg') || start.startsWith('<?xml') || start.startsWith('<!doctype svg') || start.startsWith('<!--'))) {
        return { kind: 'file', mime: 'image/svg+xml' };
      }
      if (/^(?:<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<iframe[\s>]|<!--)/u.test(start) || /<(?:script|iframe|html|body)[\s>]/u.test(start)) {
        return { kind: 'file', mime: 'text/html' };
      }
      return { kind: 'file', mime: 'text/plain' };
    }
  }
  return { kind: 'file', mime: 'application/octet-stream' };
}

function provisionalKind(declaredType: string | undefined): SandboxMediaKind {
  const major = (declaredType ?? '').split('/')[0]!.trim().toLowerCase();
  return major === 'image' || major === 'audio' || major === 'video' ? major : 'file';
}

/** File names are metadata only; one with any path component (or a control character) is refused. */
export function validateSandboxMediaFileName(name: string | undefined): string | undefined {
  if (name === undefined || name === '') return undefined;
  // eslint-disable-next-line no-control-regex
  if (name.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(name) || name === '.' || name === '..' || name.trim() !== name) {
    throw new SandboxMediaError('invalid_name', 400, 'File name must not contain path components');
  }
  return name;
}

interface SecretFile { readonly version: 1; readonly current: string; readonly previous?: string }

export class SandboxMediaStore {
  readonly endpointId: string;
  readonly dirKey: string;
  readonly config: ResolvedSandboxMediaConfig;
  readonly #root: string;
  readonly #dir: string;
  readonly #now: () => number;
  readonly #index = new Map<string, SandboxMediaMeta>();
  /** Bytes of uploads in flight, per uploader (quota checks see them). */
  readonly #reserved = new Map<string, number>();
  #loaded = false;

  constructor(options: SandboxMediaStoreOptions) {
    this.endpointId = options.endpointId;
    this.dirKey = sandboxMediaDirKey(options.endpointId);
    this.config = options.config;
    this.#root = options.root;
    this.#dir = join(options.root, this.dirKey);
    this.#now = options.now ?? Date.now;
  }

  /** Live objects (expired ones are swept first). */
  list(): readonly SandboxMediaMeta[] {
    this.#ensureLoaded();
    this.sweep();
    return [...this.#index.values()];
  }

  /** Metadata of a live object; anything that is not a well-formed id is simply not found. */
  get(id: unknown): SandboxMediaMeta | undefined {
    if (typeof id !== 'string' || !SANDBOX_MEDIA_ID_PATTERN.test(id)) return undefined;
    this.#ensureLoaded();
    const meta = this.#index.get(id);
    if (!meta) return undefined;
    if (meta.expiresAt <= this.#now()) {
      this.delete(id);
      return undefined;
    }
    return meta;
  }

  usage(uploader?: string): number {
    this.#ensureLoaded();
    let total = 0;
    for (const meta of this.#index.values()) {
      if (meta.expiresAt > this.#now() && (uploader === undefined || meta.uploader === uploader)) total += meta.size;
    }
    for (const [who, bytes] of this.#reserved) if (uploader === undefined || who === uploader) total += bytes;
    return total;
  }

  async put(input: SandboxMediaPutInput): Promise<SandboxMediaMeta> {
    const name = validateSandboxMediaFileName(input.fileName);
    const conversation = validConversation(input.conversation, this.endpointId);
    const length = input.declaredLength;
    if (length === undefined || !Number.isSafeInteger(length) || length < 0) throw new SandboxMediaError('length_required', 411, 'Content-Length is required');
    if (length === 0 || !input.body) throw new SandboxMediaError('empty', 400, 'The upload is empty');
    const provisional = provisionalKind(input.declaredType);
    const limit = Math.min(this.config.maxBytes[provisional], SANDBOX_MEDIA_HARD_MAX_FILE_BYTES);
    if (length > limit) throw new SandboxMediaError('too_large', 413, `The file is larger than ${limit} bytes`);
    this.#ensureLoaded();
    this.sweep();
    if (this.usage(input.uploader) + length > this.config.uploaderQuotaBytes) {
      throw new SandboxMediaError('uploader_quota_exceeded', 507, 'Your Sandbox media quota is used up; delete uploads or wait until they expire');
    }
    if (this.usage() + length > this.config.quotaBytes) {
      throw new SandboxMediaError('quota_exceeded', 507, 'The Sandbox media quota of this endpoint is used up');
    }
    this.#reserved.set(input.uploader, (this.#reserved.get(input.uploader) ?? 0) + length);
    const id = randomBytes(16).toString('base64url');
    const part = join(this.#dir, `${id}.part`);
    let fd: number | undefined;
    try {
      ensureDir(this.#root);
      ensureDir(this.#dir);
      fd = openSync(part, 'wx', 0o600);
      const hash = createHash('sha256');
      const head: Buffer[] = [];
      let headBytes = 0;
      let size = 0;
      const reader = input.body.getReader();
      try {
        for (;;) {
          if (input.signal?.aborted) throw new SandboxMediaError('aborted', 499, 'The upload was aborted');
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          // Counted while receiving: a body longer than declared (or than the limit) stops here.
          if (size > length) throw new SandboxMediaError(size > limit ? 'too_large' : 'length_mismatch', size > limit ? 413 : 400, 'The body is longer than Content-Length');
          hash.update(value);
          if (headBytes < SNIFF_BYTES) { head.push(Buffer.from(value.subarray(0, SNIFF_BYTES - headBytes))); headBytes += Math.min(value.byteLength, SNIFF_BYTES - headBytes); }
          writeAll(fd, value);
        }
      } finally {
        reader.releaseLock?.();
      }
      if (size !== length) throw new SandboxMediaError('length_mismatch', 400, 'The body is shorter than Content-Length');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      const sniffed = sniffSandboxMedia(Buffer.concat(head));
      const kindLimit = Math.min(this.config.maxBytes[sniffed.kind], SANDBOX_MEDIA_HARD_MAX_FILE_BYTES);
      if (size > kindLimit) throw new SandboxMediaError('too_large', 413, `The file is larger than ${kindLimit} bytes`);
      const createdAt = this.#now();
      // `exp` is signed in whole seconds; the object expires exactly when its links do.
      const expiresAt = Math.floor((createdAt + this.config.ttlHours * 3_600_000) / 1000) * 1000;
      const meta: SandboxMediaMeta = Object.freeze({
        version: 1, id, kind: sniffed.kind, mime: sniffed.mime, size, ...(name ? { name } : {}),
        sha256: hash.digest('hex'), createdAt, expiresAt, uploader: input.uploader, conversation,
        disposition: sniffed.kind === 'file' ? 'attachment' : 'inline',
      });
      writeFileSync(join(this.#dir, `${id}.json`), JSON.stringify(meta), { mode: 0o600 });
      renameSync(part, join(this.#dir, id));
      this.#index.set(id, meta);
      return meta;
    } catch (error) {
      if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
      rmSync(part, { force: true });
      rmSync(join(this.#dir, `${id}.json`), { force: true });
      throw error;
    } finally {
      const left = (this.#reserved.get(input.uploader) ?? 0) - length;
      if (left > 0) this.#reserved.set(input.uploader, left); else this.#reserved.delete(input.uploader);
    }
  }

  /** Deleting an object revokes every link to it at once. */
  delete(id: string): boolean {
    if (!SANDBOX_MEDIA_ID_PATTERN.test(id)) return false;
    this.#ensureLoaded();
    const existed = this.#index.delete(id);
    rmSync(join(this.#dir, id), { force: true });
    rmSync(join(this.#dir, `${id}.json`), { force: true });
    return existed;
  }

  /** Removes expired objects and stray partial files; returns how many objects were removed. */
  sweep(): number {
    this.#ensureLoaded();
    const now = this.#now();
    let removed = 0;
    for (const meta of [...this.#index.values()]) {
      if (meta.expiresAt <= now && this.delete(meta.id)) removed += 1;
    }
    return removed;
  }

  /** Signed address of a live object: `<origin>/pub/sandbox-media/<dir>/<id>?exp&sig` (signed with `current`). */
  signedUrl(meta: SandboxMediaMeta, origin: string): string {
    const exp = Math.floor(meta.expiresAt / 1000);
    const path = `${SANDBOX_MEDIA_PUBLIC_PREFIX}${this.dirKey}/${meta.id}?exp=${exp}&sig=${this.#sign(this.#secrets(true)!.current, meta.id, exp)}`;
    return `${origin.replace(/\/+$/u, '')}${path}`;
  }

  /**
   * Whether a hosted address is genuine: the fixed path prefix and signature format (the origin
   * is ignored), this endpoint's directory, an HMAC that verifies against `current` or `previous`
   * (compared in constant time), an unexpired `exp`, and a live object whose expiry it signs.
   */
  verifyUrl(url: unknown): SandboxMediaVerification {
    const address = parseSandboxMediaUrl(url);
    if (!address || address.dir !== this.dirKey) return { ok: false, reason: 'format' };
    const secrets = this.#secrets(false);
    if (!secrets) return { ok: false, reason: 'signature' };
    const presented = Buffer.from(address.sig, 'base64url');
    let valid = false;
    for (const key of [secrets.current, secrets.previous]) {
      if (!key) continue;
      const expected = Buffer.from(this.#sign(key, address.id, address.exp), 'base64url');
      // Both are 32-byte digests (the format check fixes the length); no early exit on a match.
      if (expected.length === presented.length && timingSafeEqual(expected, presented)) valid = true;
    }
    if (!valid) return { ok: false, reason: 'signature' };
    if (address.exp * 1000 <= this.#now()) return { ok: false, reason: 'expired' };
    const meta = this.get(address.id);
    if (!meta || Math.floor(meta.expiresAt / 1000) !== address.exp) return { ok: false, reason: 'missing' };
    return { ok: true, meta };
  }

  /**
   * {@link verifyUrl} plus the binding: the object must belong to `conversation` and, when given,
   * to `uploader`. This is the check a reader in another conversation fails (cross-session leak).
   */
  authorize(url: unknown, binding: { readonly conversation: SandboxMediaConversation; readonly uploader?: string }): SandboxMediaAuthorization {
    const verified = this.verifyUrl(url);
    if (!verified.ok) return verified;
    const { meta } = verified;
    if (!sameConversation(meta.conversation, binding.conversation)) return { ok: false, reason: 'conversation_mismatch' };
    if (binding.uploader !== undefined && meta.uploader !== binding.uploader) return { ok: false, reason: 'uploader_mismatch' };
    return verified;
  }

  /** Bytes of a live object as a web stream. */
  open(meta: SandboxMediaMeta): ReadableStream<Uint8Array> {
    return Readable.toWeb(createReadStream(join(this.#dir, meta.id))) as ReadableStream<Uint8Array>;
  }

  /** New `current` key; the old one stays `previous`, so links issued before keep verifying. */
  rotate(): void {
    const existing = this.#secrets(false);
    this.#writeSecrets({ version: 1, current: randomBytes(32).toString('base64url'), ...(existing ? { previous: existing.current } : {}) });
  }

  /** Rotates and drops `previous`: every link issued so far stops verifying (objects stay). */
  revokeAll(): void {
    this.#writeSecrets({ version: 1, current: randomBytes(32).toString('base64url') });
  }

  #sign(key: string, id: string, exp: number): string {
    return createHmac('sha256', Buffer.from(key, 'base64url')).update(`${this.endpointId}\0${id}\0${exp}`).digest('base64url');
  }

  #secrets(create: boolean): SecretFile | undefined {
    const file = join(this.#root, 'secret');
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SecretFile>;
      if (typeof parsed.current === 'string' && Buffer.from(parsed.current, 'base64url').length === 32) {
        return { version: 1, current: parsed.current, ...(typeof parsed.previous === 'string' ? { previous: parsed.previous } : {}) };
      }
    } catch { /* missing or unreadable: create below when asked */ }
    if (!create) return undefined;
    const fresh: SecretFile = { version: 1, current: randomBytes(32).toString('base64url') };
    this.#writeSecrets(fresh);
    return fresh;
  }

  #writeSecrets(secrets: SecretFile): void {
    ensureDir(this.#root);
    const file = join(this.#root, 'secret');
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temp, JSON.stringify(secrets), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    if (!existsSync(this.#dir)) return;
    for (const entry of readdirSync(this.#dir)) {
      if (entry.endsWith('.part')) {
        // A crashed upload: never served, removed once it is clearly stale.
        try { if (statSync(join(this.#dir, entry)).mtimeMs < this.#now() - 3_600_000) rmSync(join(this.#dir, entry), { force: true }); } catch { /* gone */ }
        continue;
      }
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      if (!SANDBOX_MEDIA_ID_PATTERN.test(id)) continue;
      try {
        const meta = JSON.parse(readFileSync(join(this.#dir, entry), 'utf8')) as SandboxMediaMeta;
        if (meta?.id === id && existsSync(join(this.#dir, id)) && typeof meta.expiresAt === 'number') this.#index.set(id, Object.freeze(meta));
        else rmSync(join(this.#dir, entry), { force: true });
      } catch {
        rmSync(join(this.#dir, entry), { force: true });
      }
    }
  }
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeAll(fd: number, chunk: Uint8Array): void {
  let offset = 0;
  while (offset < chunk.byteLength) offset += writeSync(fd, chunk, offset, chunk.byteLength - offset);
}

function validConversation(conversation: SandboxMediaConversation, endpointId: string): SandboxMediaConversation {
  const { type, id } = conversation ?? {};
  if ((type !== 'private' && type !== 'group' && type !== 'channel') || typeof id !== 'string' || !id || id.length > 256 || conversation.endpoint !== endpointId) {
    throw new SandboxMediaError('invalid_conversation', 400, 'A valid conversation (type and id) is required');
  }
  return Object.freeze({ endpoint: endpointId, type, id });
}

function sameConversation(a: SandboxMediaConversation, b: SandboxMediaConversation): boolean {
  return a.endpoint === b.endpoint && a.type === b.type && a.id === b.id;
}
