import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseInfo } from "./ilink-types.js";

export const ILINK_APP_ID = "bot";
export const DEFAULT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const DEFAULT_API_BASE_URL = "https://ilinkai.weixin.qq.com";

const DEFAULT_BOT_AGENT = "Zhin.js";
const BOT_AGENT_MAX_LEN = 256;

let channelVersion = "0.0.0";
let configuredBotAgent: string | undefined;

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

channelVersion = readPackageVersion();

export function configureIlinkMeta(opts: { botAgent?: string; version?: string }): void {
  if (opts.botAgent) configuredBotAgent = opts.botAgent;
  if (opts.version) channelVersion = opts.version;
}

export function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export const ILINK_APP_CLIENT_VERSION = buildClientVersion(channelVersion);

export function sanitizeBotAgent(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return configuredBotAgent ?? DEFAULT_BOT_AGENT;
  const trimmed = raw.trim();
  if (!trimmed) return configuredBotAgent ?? DEFAULT_BOT_AGENT;
  const productRe = /^[A-Za-z0-9_.\-]{1,32}\/[A-Za-z0-9_.+\-]{1,32}$/;
  const tokens = trimmed.split(/\s+/).filter((tok) => productRe.test(tok));
  if (tokens.length === 0) return configuredBotAgent ?? DEFAULT_BOT_AGENT;
  const joined = tokens.join(" ");
  if (Buffer.byteLength(joined, "utf-8") <= BOT_AGENT_MAX_LEN) return joined;
  return (configuredBotAgent ?? DEFAULT_BOT_AGENT);
}

export function buildBaseInfo(): BaseInfo {
  return {
    channel_version: channelVersion,
    bot_agent: sanitizeBotAgent(configuredBotAgent),
  };
}
