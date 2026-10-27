/** Image bytes stop at this boundary; tool results and history carry the public URL. */
export interface PublishedImage {
  readonly image_url: string;
  readonly mime: string;
  readonly size: number;
}

export interface ImageAssetPublisher {
  publish(bytes: Uint8Array, signal?: AbortSignal): Promise<PublishedImage>;
  /** Only URLs in this publisher's image namespace may bypass model URL fetching. */
  ownsUrl(url: string): boolean;
}

/** Optional Host configuration. Credentials are resolved from environment variables by the Host. */
export interface R2ImageStorageConfig {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly publicBaseUrl: string;
  /** Bucket lifecycle rules must cover this prefix. */
  readonly prefix: string;
}
