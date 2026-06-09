import { createRequire } from "node:module";
import adapterPkg from "../package.json" with { type: "json" };

const require = createRequire(import.meta.url);

function readDepVersion(dep: string): string {
  try {
    return (require(`${dep}/package.json`) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

/** HTTP header name for outbound QQ API requests. */
export const SDK_VERSION_HEADER = "x-sdk-version";

/**
 * Composite SDK identity: Zhin adapter + underlying qq-official-bot.
 * Example: `zhin-adapter-qq/v2.0.11+qq-official-bot/v1.2.1`
 */
export const SDK_VERSION = `zhin-adapter-qq/v${adapterPkg.version}+qq-official-bot/v${readDepVersion("qq-official-bot")}`;
