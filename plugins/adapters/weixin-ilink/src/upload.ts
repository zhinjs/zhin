import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { fetchOutboundMedia, isOutboundMediaRefused, OutboundMediaFetchError, type OutboundMediaFetcher } from '@zhin.js/core';

import { getUploadUrl, type WeixinApiOptions } from './ilink-api.js';

import { aesEcbPaddedSize } from "./aes-ecb.js";
import { uploadBufferToCdn } from "./cdn-upload.js";
import { logger } from "./ilink-logger.js";
import { getExtensionFromContentTypeOrUrl } from "./mime.js";
import { tempFileName } from "./ilink-random.js";
import { UploadMediaType } from "./ilink-types.js";

export type UploadedFileInfo = {
  filekey: string;
  /** 由 upload_param 上传后 CDN 返回的下载加密参数; fill into ImageItem.media.encrypt_query_param */
  downloadEncryptedQueryParam: string;
  /** AES-128-ECB key, hex-encoded; convert to base64 for CDNMedia.aes_key */
  aeskey: string;
  /** Plaintext file size in bytes */
  fileSize: number;
  /** Ciphertext file size in bytes (AES-128-ECB with PKCS7 padding); use for ImageItem.hd_size / mid_size */
  fileSizeCiphertext: number;
};

/**
 * Download a remote media URL (image, video, file) to a local temp file in destDir.
 * Returns the local file path; extension is inferred from Content-Type / URL.
 *
 * The URL is downloaded on this host, so only through core `fetchOutboundMedia` (public HTTPS only,
 * pinned DNS, every redirect checked, size and time bounded; #1250 第 46 批). A refused URL rethrows the
 * `OutboundMediaFetchError` (`refused`) so the caller can send a notice instead; logs carry the host only.
 */
export async function downloadRemoteImageToTemp(
  url: string,
  destDir: string,
  signal?: AbortSignal,
  fetchMedia: OutboundMediaFetcher = fetchOutboundMedia,
): Promise<string> {
  const host = hostOf(url);
  logger.debug(`downloadRemoteImageToTemp: fetching host=${host}`);
  signal?.throwIfAborted();
  let fetched: Awaited<ReturnType<OutboundMediaFetcher>>;
  try {
    fetched = await fetchMedia(url, { ...(signal ? { signal } : {}), source: 'weixin-ilink' });
  } catch (error) {
    if (isOutboundMediaRefused(error)) throw error;
    signal?.throwIfAborted();
    const reason = error instanceof OutboundMediaFetchError ? `${error.code}${error.status !== undefined ? ` ${error.status}` : ''}` : 'error';
    const msg = `remote media download failed: ${reason} host=${host}`;
    logger.error(`downloadRemoteImageToTemp: ${msg}`);
    throw new Error(msg, { cause: error });
  }
  const buf = fetched.bytes;
  logger.debug(`downloadRemoteImageToTemp: downloaded ${buf.length} bytes`);
  await fs.mkdir(destDir, { recursive: true });
  const ext = getExtensionFromContentTypeOrUrl(fetched.mimeType ?? null, fetched.url);
  const name = tempFileName("weixin-remote", ext);
  const filePath = path.join(destDir, name);
  await fs.writeFile(filePath, buf, { signal });
  logger.debug(`downloadRemoteImageToTemp: saved to ${filePath} ext=${ext}`);
  return filePath;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname || "invalid"; } catch { return "invalid"; }
}

/**
 * Common upload pipeline: read file → hash → gen aeskey → getUploadUrl → uploadBufferToCdn → return info.
 */
async function uploadMediaToCdn(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType];
  label: string;
}): Promise<UploadedFileInfo> {
  const { filePath, toUserId, opts, cdnBaseUrl, mediaType, label } = params;

  const plaintext = await fs.readFile(filePath, { signal: opts.abortSignal });
  opts.abortSignal?.throwIfAborted();
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  logger.debug(
    `${label}: file=${filePath} rawsize=${rawsize} filesize=${filesize} md5=${rawfilemd5} filekey=${filekey}`,
  );

  const uploadUrlResp = await getUploadUrl({
    ...opts,
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const uploadFullUrl = uploadUrlResp.upload_full_url?.trim();
  const uploadParam = uploadUrlResp.upload_param;
  if (!uploadFullUrl && !uploadParam) {
    logger.error(
      `${label}: getUploadUrl returned no upload URL (need upload_full_url or upload_param), resp=${JSON.stringify(uploadUrlResp)}`,
    );
    throw new Error(`${label}: getUploadUrl returned no upload URL`);
  }

  const { downloadParam: downloadEncryptedQueryParam } = await uploadBufferToCdn({
    buf: plaintext,
    abortSignal: opts.abortSignal,
    uploadFullUrl: uploadFullUrl || undefined,
    uploadParam: uploadParam ?? undefined,
    filekey,
    cdnBaseUrl,
    aeskey,
    label: `${label}[orig filekey=${filekey}]`,
  });

  return {
    filekey,
    downloadEncryptedQueryParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

/** Upload a local image file to the Weixin CDN with AES-128-ECB encryption. */
export async function uploadFileToWeixin(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    ...params,
    mediaType: UploadMediaType.IMAGE,
    label: "uploadFileToWeixin",
  });
}

/** Upload a local video file to the Weixin CDN. */
export async function uploadVideoToWeixin(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    ...params,
    mediaType: UploadMediaType.VIDEO,
    label: "uploadVideoToWeixin",
  });
}

/**
 * Upload a local file attachment (non-image, non-video) to the Weixin CDN.
 * Uses media_type=FILE; no thumbnail required.
 */
export async function uploadFileAttachmentToWeixin(params: {
  filePath: string;
  fileName: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    ...params,
    mediaType: UploadMediaType.FILE,
    label: "uploadFileAttachmentToWeixin",
  });
}
