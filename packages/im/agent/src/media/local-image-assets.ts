import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { Message } from '@zhin.js/core';
import { createToken } from '@zhin.js/plugin-runtime';
import { decodeBase64, inspectMediaBytes } from './media-normalize.js';
import { DEFAULT_MULTIMODAL_CONFIG } from './media-types.js';

export const LOCAL_IMAGE_LIMITS = Object.freeze({ retentionMs: 7 * 86_400_000, maxBytes: 1024 ** 3, maxCount: 1_000 });
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface LocalImageReference {
  readonly asset_id: string;
  readonly mime: string;
  readonly size: number;
  readonly expires_at: number;
}
interface StoredImage extends LocalImageReference {
  readonly scope: string;
  readonly source: string;
}
export type LocalImageScope = Pick<ToolInvocationContext, 'origin' | 'principal' | 'sessionKey'>;

export function localImageScopeFromMessage(message: Message | undefined, sessionKey: string): LocalImageScope | undefined {
  if (!message?.conversation || !message.sender?.id) return undefined;
  const conversation = message.conversation;
  return { sessionKey, origin: { kind: 'im', platform: conversation.endpoint.adapter, endpoint: conversation.endpoint.id,
    scope: conversation.kind, sceneId: conversation.id, threadId: conversation.threadId },
  principal: { subjectId: message.sender.id, roles: message.sender.roles ?? [] } };
}

/** The directory is owned by one Host; identities survive generation changes and restarts. */
function scopeKey(context: LocalImageScope): string {
  const origin = context.origin;
  const address = origin.kind === 'im'
    ? [origin.kind, origin.platform, origin.endpoint, origin.scope, origin.sceneId, origin.threadId ?? '']
    : origin.kind === 'http' ? [origin.kind, origin.sessionId]
      : origin.kind === 'a2a' ? [origin.kind, origin.taskId]
        : origin.kind === 'schedule' ? [origin.kind, origin.jobId]
          : [origin.kind, context.sessionKey];
  return createHash('sha256').update(JSON.stringify([...address, context.principal.subjectId])).digest('hex');
}

/** Host-owned private store; only metadata stays resident, never image bytes. */
export class LocalImageAssetStore {
  readonly #inspections = new WeakSet<object>();
  #tail: Promise<unknown> = Promise.resolve();
  #leases = 0;
  #queuedBytes = 0;
  #queuedCount = 0;
  #records?: Map<string, StoredImage>;
  #timer?: ReturnType<typeof setInterval>;
  readonly directory: string;
  private readonly warn: (message: string) => void;
  private readonly now: () => number;
  private readonly limits: Readonly<{ retentionMs: number; maxBytes: number; maxCount: number }>;

  constructor(
    directory: string,
    warn: (message: string) => void = () => {},
    now: () => number = Date.now,
    limits: Readonly<{ retentionMs: number; maxBytes: number; maxCount: number }> = LOCAL_IMAGE_LIMITS,
  ) {
    this.directory = directory;
    this.warn = warn;
    this.now = now;
    this.limits = limits;
  }

  /** Overlapping generation leases share one timer and one write queue. */
  async acquire(): Promise<() => void> {
    this.#leases += 1;
    if (!this.#timer) {
      this.#timer = setInterval(() => { void this.cleanup().catch(() => this.warn('Local image cleanup failed')); }, 3_600_000);
      this.#timer.unref();
    }
    await this.cleanup().catch(() => this.warn('Local image cleanup failed'));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.#leases === 0) { clearInterval(this.#timer); this.#timer = undefined; }
    };
  }

  async capture(base64: string, scope: LocalImageScope, source: string, signal?: AbortSignal): Promise<LocalImageReference> {
    const estimatedBytes = Math.ceil(base64.length * 3 / 4);
    if (estimatedBytes > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes + 2) throw new Error('Invalid or oversized local image');
    if (this.#queuedCount >= this.limits.maxCount || this.#queuedBytes + estimatedBytes > this.limits.maxBytes) {
      throw new Error('Local image storage is full');
    }
    this.#queuedCount += 1;
    this.#queuedBytes += estimatedBytes;
    return this.#serial(async () => {
      signal?.throwIfAborted();
      const bytes = decodeBase64(base64, DEFAULT_MULTIMODAL_CONFIG.maxFileBytes);
      const detected = bytes && inspectMediaBytes(bytes, 'image');
      if (!bytes || !detected || !IMAGE_TYPES.has(detected.mimeType)) throw new Error('Invalid or oversized local image');
      const live = await this.#scan();
      if (live.length >= this.limits.maxCount || live.reduce((sum, item) => sum + item.size, 0) + bytes.length > this.limits.maxBytes) {
        throw new Error('Local image storage is full');
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Local image directory cannot be a symbolic link');
      const id = randomUUID();
      const record: StoredImage = { asset_id: id, mime: detected.mimeType, size: bytes.length,
        expires_at: this.now() + this.limits.retentionMs, scope: scopeKey(scope), source };
      const temporary = join(this.directory, `.tmp-${id}`);
      await mkdir(temporary, { mode: 0o700 });
      try {
        await this.#write(join(temporary, 'image'), bytes, signal);
        await this.#write(join(temporary, 'metadata.json'), Buffer.from(JSON.stringify(record)), signal);
        signal?.throwIfAborted();
        await rename(temporary, join(this.directory, id));
        this.#records!.set(id, record);
      } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
      return referenceOf(record);
    }).finally(() => { this.#queuedCount -= 1; this.#queuedBytes -= estimatedBytes; });
  }

  async inspect(id: string, scope: LocalImageScope, signal?: AbortSignal): Promise<LocalImageReference> {
    return this.#serial(async () => {
      signal?.throwIfAborted();
      const record = await this.#authorized(id, scope);
      const result = referenceOf(record);
      this.#inspections.add(result);
      return result;
    });
  }

  /** Only a result minted by get_local_assets can request model-time materialization. */
  isInspection(value: unknown): value is LocalImageReference {
    return typeof value === 'object' && value !== null && this.#inspections.has(value);
  }

  async read(id: string, scope: LocalImageScope, signal?: AbortSignal): Promise<{ reference: LocalImageReference; bytes: Buffer }> {
    return this.#serial(async () => {
      signal?.throwIfAborted();
      const record = await this.#authorized(id, scope);
      const bytes = await this.#read(join(this.directory, id, 'image'), DEFAULT_MULTIMODAL_CONFIG.maxFileBytes, signal);
      if (bytes.length !== record.size || inspectMediaBytes(bytes, 'image')?.mimeType !== record.mime) {
        throw new Error('Local image is unavailable');
      }
      return { reference: referenceOf(record), bytes };
    });
  }

  cleanup(): Promise<void> { return this.#serial(async () => { await this.#scan(); }); }

  async #authorized(id: string, scope: LocalImageScope): Promise<StoredImage> {
    if (!ASSET_ID.test(id)) throw new Error('Local image is unavailable');
    const record = await this.#metadata(id);
    if (record.scope !== scopeKey(scope) || record.expires_at <= this.now()) throw new Error('Local image is unavailable');
    return record;
  }

  async #metadata(id: string): Promise<StoredImage> {
    const dir = join(this.directory, id);
    if (!(await lstat(dir)).isDirectory()) throw new Error('Local image is unavailable');
    const record = JSON.parse((await this.#read(join(dir, 'metadata.json'), 16_384)).toString('utf8')) as StoredImage;
    if (record.asset_id !== id || !Number.isSafeInteger(record.size) || record.size < 1
      || record.size > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes || !Number.isFinite(record.expires_at)
      || typeof record.scope !== 'string' || !IMAGE_TYPES.has(record.mime)) throw new Error('Invalid local image metadata');
    return record;
  }

  async #scan(): Promise<StoredImage[]> {
    if (this.#records) {
      for (const [id, record] of this.#records) {
        if (record.expires_at <= this.now()) {
          await rm(join(this.directory, id), { recursive: true, force: true });
          this.#records.delete(id);
        }
      }
      return [...this.#records.values()];
    }
    let entries;
    try {
      if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Local image directory cannot be a symbolic link');
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.#records = new Map(); return []; }
      throw error;
    }
    const live: StoredImage[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.tmp-') && ASSET_ID.test(entry.name.slice(5))) {
        // The Host's serial queue excludes active writes; these are interrupted writes from a previous process.
        await rm(join(this.directory, entry.name), { recursive: true, force: true });
      } else if (ASSET_ID.test(entry.name)) {
        const record = await this.#metadata(entry.name);
        if (record.expires_at <= this.now()) await rm(join(this.directory, entry.name), { recursive: true, force: true });
        else live.push(record);
      }
    }
    this.#records = new Map(live.map(record => [record.asset_id, record]));
    return live;
  }

  async #read(path: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > limit) throw new Error('Local image is unavailable');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('Local image is unavailable');
        offset += bytesRead;
      }
      signal?.throwIfAborted();
      return bytes;
    } finally { await file.close(); }
  }

  async #write(path: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes, { signal }); } finally { await file.close(); }
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => {});
    return result;
  }
}

function referenceOf(record: StoredImage): LocalImageReference {
  return Object.freeze({ asset_id: record.asset_id, mime: record.mime, size: record.size, expires_at: record.expires_at });
}

export const localImageAssetsToken = createToken<LocalImageAssetStore>('zhin.agent.local-image-assets');
