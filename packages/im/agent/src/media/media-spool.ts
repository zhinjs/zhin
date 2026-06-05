import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { MediaBinaryPayload } from './media-types.js';

export function spoolPayloadToFile(
  payload: MediaBinaryPayload,
  baseDir: string,
  subdir = 'tmp',
): string {
  const ext = extensionForMime(payload.mimeType, payload.kind);
  const name = `${payload.kind}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const dir = path.join(baseDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from(payload.base64, 'base64'));
  return filePath;
}

function extensionForMime(mime: string, kind: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
  };
  return map[mime] || (kind === 'audio' ? '.mp3' : kind === 'video' ? '.mp4' : '.bin');
}
