import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const playground = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv({ path: path.join(playground, ".env") }).parsed ?? {};

const lines = [
  `ZHIN_PROJECT_ROOT=${playground}`,
  "SANDBOX_TRANSPORT=http-sse",
  "SANDBOX_BOT_NAME=edge-bot",
];

for (const key of ["HTTP_TOKEN", "OPENAI_API_KEY", "OPENAI_BASE_URL", "DATABASE_URL"]) {
  const value = env[key]?.trim();
  if (value) lines.push(`${key}=${value}`);
}

const out = path.join(playground, ".dev.vars");
fs.writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
console.log(`[write-dev-vars] ${out}`);
