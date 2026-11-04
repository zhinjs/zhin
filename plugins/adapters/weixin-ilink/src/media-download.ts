import type { WeixinInboundMediaOpts } from "./weixin-inbound.js";
import { logger } from "./ilink-logger.js";
import { getMimeFromFilename } from "./mime.js";
import {
  downloadAndDecryptBuffer,
  downloadPlainCdnBuffer,
} from "./pic-decrypt.js";
import { silkToWav } from "./silk-transcode.js";
import { MessageItemType, type WeixinMessage } from './ilink-types.js';

const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/** Exact write request; storage policy remains with the owning Client. */
export interface SaveMediaRequest {
  readonly buffer: Buffer;
  readonly contentType?: string;
  readonly subdir?: string;
  readonly maxBytes?: number;
  readonly originalFilename?: string;
}
type SaveMediaFn = (request: SaveMediaRequest) => Promise<{ path: string }>;

/**
 * Download and decrypt media from a single MessageItem.
 * Returns the populated WeixinInboundMediaOpts fields; empty object on unsupported type or failure.
 */
export async function downloadMediaFromItem(
  item: WeixinMessage["item_list"] extends (infer T)[] | undefined ? T : never,
  deps: {
    cdnBaseUrl: string;
    saveMedia: SaveMediaFn;
    log: (msg: string) => void;
    errLog: (msg: string) => void;
    label: string;
    signal?: AbortSignal;
  },
): Promise<WeixinInboundMediaOpts> {
  const { cdnBaseUrl, saveMedia: persistMedia, log, errLog, label, signal } = deps;
  signal?.throwIfAborted();
  const saveMedia: SaveMediaFn = request => { signal?.throwIfAborted(); return persistMedia(request); };
  const result: WeixinInboundMediaOpts = {};

  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item;
    if (!img?.media?.encrypt_query_param && !img?.media?.full_url) return result;
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, "hex").toString("base64")
      : img.media.aes_key;
    logger.debug(
      `${label} image: encrypt_query_param=${(img.media.encrypt_query_param ?? "").slice(0, 40)}... hasAesKey=${Boolean(aesKeyBase64)} aeskeySource=${img.aeskey ? "image_item.aeskey" : "media.aes_key"} full_url=${Boolean(img.media.full_url)}`,
    );
    try {
      const buf = aesKeyBase64
        ? await downloadAndDecryptBuffer({
          encryptedQueryParam: img.media.encrypt_query_param ?? "",
          aesKeyBase64,
          cdnBaseUrl,
          label: `${label} image`,
          fullUrl: img.media.full_url,
          signal,
        })
        : await downloadPlainCdnBuffer({
          encryptedQueryParam: img.media.encrypt_query_param ?? "",
          cdnBaseUrl,
          label: `${label} image-plain`,
          fullUrl: img.media.full_url,
          signal,
        });
      const saved = await saveMedia({
        buffer: buf,
        contentType: undefined,
        subdir: "inbound",
        maxBytes: WEIXIN_MEDIA_MAX_BYTES,
      });
      result.decryptedPicPath = saved.path;
      logger.debug(`${label} image saved: ${saved.path}`);
    } catch (err) {
      signal?.throwIfAborted();
      logger.error(`${label} image download/decrypt failed: ${String(err)}`);
      errLog(`weixin ${label} image download/decrypt failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item;
    if ((!voice?.media?.encrypt_query_param && !voice?.media?.full_url) || !voice?.media?.aes_key)
      return result;
    try {
      const silkBuf = await downloadAndDecryptBuffer({
        encryptedQueryParam: voice.media.encrypt_query_param ?? "",
        aesKeyBase64: voice.media.aes_key,
        cdnBaseUrl,
        label: `${label} voice`,
        fullUrl: voice.media.full_url,
        signal,
      });
      logger.debug(`${label} voice: decrypted ${silkBuf.length} bytes, attempting silk transcode`);
      const wavBuf = await silkToWav(silkBuf);
      if (wavBuf) {
        const saved = await saveMedia({
          buffer: wavBuf,
          contentType: "audio/wav",
          subdir: "inbound",
          maxBytes: WEIXIN_MEDIA_MAX_BYTES,
        });
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/wav";
        logger.debug(`${label} voice: saved WAV to ${saved.path}`);
      } else {
        const saved = await saveMedia({
          buffer: silkBuf,
          contentType: "audio/silk",
          subdir: "inbound",
          maxBytes: WEIXIN_MEDIA_MAX_BYTES,
        });
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/silk";
        logger.debug(`${label} voice: silk transcode unavailable, saved raw SILK to ${saved.path}`);
      }
    } catch (err) {
      signal?.throwIfAborted();
      logger.error(`${label} voice download/transcode failed: ${String(err)}`);
      errLog(`weixin ${label} voice download/transcode failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item;
    if ((!fileItem?.media?.encrypt_query_param && !fileItem?.media?.full_url) || !fileItem?.media?.aes_key)
      return result;
    try {
      const buf = await downloadAndDecryptBuffer({
        encryptedQueryParam: fileItem.media.encrypt_query_param ?? "",
        aesKeyBase64: fileItem.media.aes_key,
        cdnBaseUrl,
        label: `${label} file`,
        fullUrl: fileItem.media.full_url,
        signal,
      });
      const mime = getMimeFromFilename(fileItem.file_name ?? "file.bin");
      const saved = await saveMedia({
        buffer: buf,
        contentType: mime,
        subdir: "inbound",
        maxBytes: WEIXIN_MEDIA_MAX_BYTES,
        originalFilename: fileItem.file_name ?? undefined,
      });
      result.decryptedFilePath = saved.path;
      result.fileMediaType = mime;
      logger.debug(`${label} file: saved to ${saved.path} mime=${mime}`);
    } catch (err) {
      signal?.throwIfAborted();
      logger.error(`${label} file download failed: ${String(err)}`);
      errLog(`weixin ${label} file download failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VIDEO) {
    const videoItem = item.video_item;
    if ((!videoItem?.media?.encrypt_query_param && !videoItem?.media?.full_url) || !videoItem?.media?.aes_key)
      return result;
    try {
      const buf = await downloadAndDecryptBuffer({
        encryptedQueryParam: videoItem.media.encrypt_query_param ?? "",
        aesKeyBase64: videoItem.media.aes_key,
        cdnBaseUrl,
        label: `${label} video`,
        fullUrl: videoItem.media.full_url,
        signal,
      });
      const saved = await saveMedia({
        buffer: buf,
        contentType: "video/mp4",
        subdir: "inbound",
        maxBytes: WEIXIN_MEDIA_MAX_BYTES,
      });
      result.decryptedVideoPath = saved.path;
      logger.debug(`${label} video: saved to ${saved.path}`);
    } catch (err) {
      signal?.throwIfAborted();
      logger.error(`${label} video download failed: ${String(err)}`);
      errLog(`weixin ${label} video download failed: ${String(err)}`);
    }
  }

  return result;
}
