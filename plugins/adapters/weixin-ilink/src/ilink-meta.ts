import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseInfo } from "./ilink-types.js";

export const ILINK_APP_ID = "bot";
export const DEFAULT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const DEFAULT_API_BASE_URL = "https://ilinkai.weixin.qq.com";

const DEFAULT_BOT_AGENT = "Zhin.js";
const BOT_AGENT_MAX_LEN = 256;

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const PACKAGE_VERSION = readPackageVersion();

export function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export function sanitizeBotAgent(raw: string | undefined, fallback = DEFAULT_BOT_AGENT): string {
  if (!raw || typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const productRe = /^[A-Za-z0-9_.\-]{1,32}\/[A-Za-z0-9_.+\-]{1,32}$/;
  const tokens = trimmed.split(/\s+/).filter((tok) => productRe.test(tok));
  if (tokens.length === 0) return fallback;
  const joined = tokens.join(" ");
  if (Buffer.byteLength(joined, "utf-8") <= BOT_AGENT_MAX_LEN) return joined;
  return fallback;
}

export interface IlinkClientMetadataOptions {
  readonly botAgent?: string;
  readonly version?: string;
}

/** Immutable request identity owned by one endpoint. */
export class IlinkClientMetadata {
  readonly channelVersion: string;
  readonly botAgent: string;
  readonly appClientVersion: number;

  constructor(options: IlinkClientMetadataOptions = {}) {
    this.channelVersion = options.version ?? PACKAGE_VERSION;
    const defaultBotAgent = `Zhin.js/${this.channelVersion}`;
    this.botAgent = sanitizeBotAgent(options.botAgent, defaultBotAgent);
    this.appClientVersion = buildClientVersion(this.channelVersion);
    Object.freeze(this);
  }

  buildBaseInfo(): BaseInfo {
    return {
      channel_version: this.channelVersion,
      bot_agent: this.botAgent,
    };
  }
}
