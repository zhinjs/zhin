import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Host-private storage error. No filesystem path, credential or crypto cause escapes. */
export class HostCredentialStorageError extends Error {
  constructor(readonly code: 'integrity' | 'storage') { super(`Host credential ${code}`); this.name = 'HostCredentialStorageError'; }
}
export interface SealedHostDocument {
  readonly version: 1;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}
export function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}
function fields(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HostCredentialStorageError('integrity');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== expected.length || !expected.every(key => Object.hasOwn(result, key))) throw new HostCredentialStorageError('integrity');
  return result;
}
function base64(value: unknown, bytes?: number): Buffer {
  if (typeof value !== 'string') throw new HostCredentialStorageError('integrity');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || (bytes !== undefined && decoded.length !== bytes)) throw new HostCredentialStorageError('integrity');
  return decoded;
}
export async function privateDirectory(directory: string, create: boolean): Promise<void> {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const status = await lstat(directory);
  if (!status.isDirectory() || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) throw new HostCredentialStorageError('storage');
}
export async function readPrivateDocument(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = await handle.stat();
    if (!status.isFile() || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) throw new HostCredentialStorageError('integrity');
    try { return JSON.parse(await handle.readFile('utf8')); } catch { throw new HostCredentialStorageError('integrity'); }
  } finally { await handle.close(); }
}
export async function syncPrivateDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
/** Publish fsynced complete bytes without overwriting a concurrent winner. */
export async function createPrivateDocument(directory: string, filename: string, document: unknown): Promise<boolean> {
  const temporary = join(directory, `${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(JSON.stringify(document), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, join(directory, filename)); } catch (error) { if (hasCode(error, 'EEXIST')) return false; throw error; }
    await syncPrivateDirectory(directory);
    return true;
  } finally { await unlink(temporary); }
}
function parseMaster(document: unknown): Buffer {
  const value = fields(document, ['version', 'key']);
  if (value.version !== 1) throw new HostCredentialStorageError('integrity');
  return base64(value.key, 32);
}
/** Identical AES-GCM envelope/key format as the existing personal credential vault. */
export function createHostDocumentCipher(directory: string) {
  let rootKey: Promise<Buffer> | undefined;
  const key = (create: boolean): Promise<Buffer> => {
    if (rootKey) return rootKey;
    const operation = (async () => {
      const path = join(directory, 'root-key.json');
      try { return parseMaster(await readPrivateDocument(path)); } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
        if (!create) throw new HostCredentialStorageError('integrity');
      }
      const candidate = randomBytes(32);
      await createPrivateDocument(directory, 'root-key.json', { version: 1, key: candidate.toString('base64') });
      return parseMaster(await readPrivateDocument(path));
    })();
    rootKey = operation;
    void operation.catch(() => { if (rootKey === operation) rootKey = undefined; });
    return operation;
  };
  return Object.freeze({
    async seal(plaintext: string, associatedData: Buffer): Promise<SealedHostDocument> {
      await privateDirectory(directory, true);
      const master = await key(true), iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', master, iv); cipher.setAAD(associatedData);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Object.freeze({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
    },
    async open(document: unknown, associatedData: Buffer): Promise<string> {
      const value = fields(document, ['version', 'iv', 'tag', 'ciphertext']);
      if (value.version !== 1) throw new HostCredentialStorageError('integrity');
      const iv = base64(value.iv, 12), tag = base64(value.tag, 16), ciphertext = base64(value.ciphertext);
      await privateDirectory(directory, false);
      const master = await key(false);
      try {
        const decipher = createDecipheriv('aes-256-gcm', master, iv); decipher.setAAD(associatedData); decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch { throw new HostCredentialStorageError('integrity'); }
    },
  });
}
