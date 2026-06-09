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

export function credentialsPath(botName: string): string {
  return path.join(resolveStateDir(), `${botName}.json`);
}

export function loadCredentials(botName: string): WeixinIlinkCredentials | null {
  const file = credentialsPath(botName);
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

export function saveCredentials(botName: string, creds: WeixinIlinkCredentials): void {
  const file = credentialsPath(botName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ ...creds, updatedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

export function syncBufPath(botName: string): string {
  return path.join(resolveStateDir(), `${botName}.sync-buf`);
}

export function loadSyncBuf(botName: string): string {
  const file = syncBufPath(botName);
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  } catch {
    return "";
  }
}

export function saveSyncBuf(botName: string, buf: string): void {
  const file = syncBufPath(botName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf, "utf-8");
}
