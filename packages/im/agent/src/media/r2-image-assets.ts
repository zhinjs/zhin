import { S3PublicStore } from '@zhin.js/agent-media/core';
import { inspectMediaBytes } from './media-normalize.js';
import { DEFAULT_MULTIMODAL_CONFIG } from './media-types.js';
import type { ImageAssetPublisher, PublishedImage, R2ImageStorageConfig } from './image-assets.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_KEY = /^[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/u;

/**
 * `ai.imageStorage` (Cloudflare R2) on top of agent-media's S3 store.
 * Upload signing, object naming and URL ownership come from `@zhin.js/agent-media/core`;
 * this adapter keeps zhin's config validation, the attachment size limit and the image-only rule.
 * Cleanup belongs to the operator's R2 lifecycle rule.
 */
export class R2ImageAssetPublisher implements ImageAssetPublisher {
  readonly #store: S3PublicStore;
  readonly #publicBase: string;

  constructor(config: R2ImageStorageConfig, fetchImpl: typeof fetch = fetch) {
    if (!/^[a-f0-9]{32}$/iu.test(config.accountId)) throw new Error('imageStorage.accountId must be an R2 account ID');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(config.bucket)) throw new Error('imageStorage.bucket is invalid');
    if (!config.accessKeyId?.trim() || !config.secretAccessKey?.trim()) throw new Error('imageStorage credentials are required');
    if (!/^(?:[a-zA-Z0-9_-]+\/)+$/u.test(config.prefix)) throw new Error('imageStorage.prefix must be a relative directory ending in /');
    const base = new URL(config.publicBaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
      throw new Error('imageStorage.publicBaseUrl must be an HTTPS URL without credentials, query or fragment');
    }
    this.#publicBase = `${base.href.replace(/\/+$/u, '')}/${config.prefix}`;
    this.#store = new S3PublicStore({
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      bucket: config.bucket,
      region: 'auto',
      virtualHosted: false,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      prefix: config.prefix,
      urlMode: 'public',
      publicBaseUrl: config.publicBaseUrl,
      fetch: fetchImpl,
    });
  }

  /** Only images this publisher minted: exact public URL, no query, fragment or extra path. */
  ownsUrl(url: string): boolean {
    return this.#store.ownsUrl(url) && IMAGE_KEY.test(url.slice(this.#publicBase.length));
  }

  async publish(bytes: Uint8Array, signal?: AbortSignal): Promise<PublishedImage> {
    signal?.throwIfAborted();
    if (bytes.byteLength > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) throw new Error('Image exceeds the 25 MiB attachment limit');
    const media = inspectMediaBytes(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'image');
    if (!media || !IMAGE_TYPES.has(media.mimeType)) throw new Error('Only PNG, JPEG, GIF and WebP images can be uploaded');
    const ref = await this.#store.publish({ bytes, mime: media.mimeType }, signal);
    return { image_url: ref.url, mime: ref.mime, size: ref.size };
  }
}
