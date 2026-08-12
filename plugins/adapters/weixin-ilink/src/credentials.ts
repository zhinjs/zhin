import fs from "node:fs";
import path from "node:path";

export interface WeixinIlinkCredentials {
  botToken: string;
  ilinkUserId?: string;
  ilinkBotId?: string;
  baseUrl?: string;
  updatedAt?: string;
}

const DEFAULT_DATA_DIR = "./data/weixin-ilink";

export function resolveStateDir(): string {
  return process.env.ZHIN_DATA_DIR
    ? path.join(process.env.ZHIN_DATA_DIR, "weixin-ilink")
    : DEFAULT_DATA_DIR;
}

export function credentialsPath(endpointId: string): string {
  return path.join(resolveStateDir(), `${endpointId}.json`);
}

export function loadCredentials(endpointId: string): WeixinIlinkCredentials | null {
  const file = credentialsPath(endpointId);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw) as WeixinIlinkCredentials;
    if (!data.botToken?.trim()) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveCredentials(endpointId: string, creds: WeixinIlinkCredentials): void {
  const file = credentialsPath(endpointId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ ...creds, updatedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

export function syncBufPath(endpointId: string): string {
  return path.join(resolveStateDir(), `${endpointId}.sync-buf`);
}

export function loadSyncBuf(endpointId: string): string {
  const file = syncBufPath(endpointId);
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  } catch {
    return "";
  }
}

export function saveSyncBuf(endpointId: string, buf: string): void {
  const file = syncBufPath(endpointId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf, "utf-8");
}
