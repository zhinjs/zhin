import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { inspectMediaBytes } from './media-normalize.js';
import { DEFAULT_MULTIMODAL_CONFIG } from './media-types.js';
import type { ImageAssetPublisher, PublishedImage, R2ImageStorageConfig } from './image-assets.js';

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};
const IMAGE_KEY = /^[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/u;

/** Generation-owned S3 client. Cleanup belongs to the operator's R2 lifecycle rule. */
export class R2ImageAssetPublisher implements ImageAssetPublisher {
  readonly #client: AwsClient;
  readonly #objectBase: string;
  readonly #publicBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: R2ImageStorageConfig, fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
    if (!/^[a-f0-9]{32}$/iu.test(config.accountId)) throw new Error('imageStorage.accountId must be an R2 account ID');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(config.bucket)) throw new Error('imageStorage.bucket is invalid');
    if (!config.accessKeyId?.trim() || !config.secretAccessKey?.trim()) throw new Error('imageStorage credentials are required');
    if (!/^(?:[a-zA-Z0-9_-]+\/)+$/u.test(config.prefix)) throw new Error('imageStorage.prefix must be a relative directory ending in /');
    const base = new URL(config.publicBaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
      throw new Error('imageStorage.publicBaseUrl must be an HTTPS URL without credentials, query or fragment');
    }
    this.#publicBase = `${base.href.replace(/\/+$/u, '')}/${config.prefix}`;
    this.#objectBase = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${config.prefix}`;
    this.#client = new AwsClient({
      service: 's3', region: 'auto', accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
    });
  }

  ownsUrl(url: string): boolean {
    return url.startsWith(this.#publicBase) && IMAGE_KEY.test(url.slice(this.#publicBase.length));
  }

  async publish(bytes: Uint8Array, signal?: AbortSignal): Promise<PublishedImage> {
    signal?.throwIfAborted();
    if (bytes.byteLength > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) throw new Error('Image exceeds the 25 MiB attachment limit');
    const media = inspectMediaBytes(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'image');
    const extension = media && EXTENSIONS[media.mimeType];
    if (!extension) throw new Error('Only PNG, JPEG, GIF and WebP images can be uploaded');
    const key = `${randomUUID()}.${extension}`;
    const request = await this.#client.sign(`${this.#objectBase}${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': media.mimeType, 'Cache-Control': 'no-store' },
      body: new Uint8Array(bytes),
    });
    signal?.throwIfAborted();
    // sign + fetch deliberately avoids the signing client's automatic retry loop.
    const response = await this.fetchImpl(request, { signal, redirect: 'error' });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Image upload failed (HTTP ${response.status})`);
    signal?.throwIfAborted();
    return { image_url: `${this.#publicBase}${key}`, mime: media.mimeType, size: bytes.byteLength };
  }
}
