import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
type Metadata = Record<string, string | number | boolean | undefined>;
interface Interceptors {
  use(fulfilled: (value: unknown) => unknown): number;
  eject(id: number): void;
}
interface UploadContext { buffer: Buffer; blockSize?: number; indexBase?: number; finishes: number }
const row = (value: unknown): Row => value !== null && (typeof value === 'object' || typeof value === 'function') ? value as Row : {};
const numeric = (value: unknown): number | undefined => { const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN; return Number.isSafeInteger(n) && n >= 0 ? n : undefined; };
const hash = (buffer: Buffer, algorithm = 'md5') => createHash(algorithm).update(buffer).digest('hex');
const body = (value: unknown): Row => { if (typeof value !== 'string') return row(value); try { return row(JSON.parse(value)); } catch { return {}; } };
const stage = (value: unknown): string => typeof value === 'string' ? value.split('?')[0].split('/').at(-1) ?? '' : '';

/** Same complete-set rule as the SDK patch; preserve platform index in ACKs. */
export function inferQqUploadIndexBase(parts: unknown, fileSize: number, blockSize: number): 0 | 1 | undefined {
  if (!Number.isSafeInteger(blockSize) || blockSize <= 0 || !fileSize || !Array.isArray(parts)) return undefined;
  const count = Math.ceil(fileSize / blockSize);
  if (!parts.length || parts.length !== count) return undefined;
  let base = Infinity; const indices = new Set<number>();
  for (const part of parts) { const index = row(part).index; if (typeof index !== 'number' || !Number.isSafeInteger(index)) return undefined; base = Math.min(base, index); indices.add(index); }
  if ((base !== 0 && base !== 1) || indices.size !== count) return undefined;
  for (const part of parts) { const item = row(part); const index = item.index as number; if (index < base || index >= base + count || numeric(item.block_size) !== Math.min(blockSize, fileSize - (index - base) * blockSize)) return undefined; }
  return base;
}

/** Endpoint-owned observer. Emits only whitelisted numeric/boolean metadata. */
export function installQqUploadDiagnostics(api: unknown, debug: (metadata: Metadata) => void): () => void {
  const bot = row(api); const request = row(bot.request); const interceptors = row(request.interceptors);
  const requests = interceptors.request as Interceptors | undefined; const responses = interceptors.response as Interceptors | undefined;
  const processor = row(bot.fileProcessor);
  const original = processor.uploadByChunks;
  if (!requests?.use || !responses?.use || typeof original !== 'function') return () => {};
  const storage = new AsyncLocalStorage<UploadContext>(); let active = true;
  const emit = (metadata: Metadata) => { if (active) { try { debug(metadata); } catch { /* diagnostics never affect delivery */ } } };
  const wrapped = function(this: unknown, buffer: Buffer, ...args: unknown[]) {
    return storage.run({ buffer, finishes: 0 }, () => original.call(this, buffer, ...args));
  };
  processor.uploadByChunks = wrapped;
  // Axios request hooks run LIFO, before the SDK authentication/body transformer;
  // success response hooks run FIFO, after the SDK's identity success hook.
  const requestId = requests.use(value => {
    const config = row(value); const data = body(config.data); const context = storage.getStore();
    if (stage(config.url) === 'upload_prepare') {
      emit({ op: 'qq_upload_prepare', fileType: numeric(data.file_type), fileSize: numeric(data.file_size), actualSize: context?.buffer.length,
        ...(context ? { sizeMatch: numeric(data.file_size) === context.buffer.length, hashMatch: data.md5 === hash(context.buffer) && data.sha1 === hash(context.buffer, 'sha1') && data.md5_10m === hash(context.buffer.subarray(0, 10002432)) } : {}) });
    } else if (stage(config.url) === 'upload_part_finish' && context && context.finishes++ < 8) {
      const index = numeric(data.part_index); const length = numeric(data.block_size); const blockSize = context.blockSize; const base = context.indexBase;
      const expected = index !== undefined && blockSize && base !== undefined ? context.buffer.subarray((index - base) * blockSize, (index - base + 1) * blockSize) : undefined;
      emit({ op: 'qq_upload_part_finish', index, blockSize: length, ...(expected ? { sizeMatch: length === expected.length, hashMatch: data.md5 === hash(expected) } : {}) });
    }
    return value;
  });
  const responseId = responses.use(value => {
    const response = row(value); const config = row(response.config);
    if (stage(config.url) !== 'upload_prepare') return value;
    const data = row(response.data); const parts = Array.isArray(data.parts) ? data.parts.slice(0, 128).map(row) : undefined;
    const blockSize = numeric(data.block_size); const context = storage.getStore(); if (context) { context.blockSize = blockSize; context.indexBase = blockSize ? inferQqUploadIndexBase(data.parts, context.buffer.length, blockSize) : undefined; }
    const indices = parts?.map(part => numeric(part.index)).filter((index): index is number => index !== undefined) ?? [];
    const sizes = parts?.map(part => numeric(part.block_size)).filter((size): size is number => size !== undefined) ?? [];
    emit({ op: 'qq_upload_prepared', blockSize, partsPresent: parts !== undefined, partsCount: Array.isArray(data.parts) ? data.parts.length : undefined, inspectedCount: parts?.length,
      validIndices: indices.length, ...(indices.length ? { minIndex: Math.min(...indices), maxIndex: Math.max(...indices) } : {}),
      validSizes: sizes.length, ...(sizes.length ? { minPartSize: Math.min(...sizes), maxPartSize: Math.max(...sizes) } : {}),
      ...(context && blockSize ? { coverageMatch: context.indexBase !== undefined, indexBase: context.indexBase } : {}) });
    return value;
  });
  return () => { active = false; requests.eject(requestId); responses.eject(responseId); if (processor.uploadByChunks === wrapped) processor.uploadByChunks = original; storage.disable(); };
}
