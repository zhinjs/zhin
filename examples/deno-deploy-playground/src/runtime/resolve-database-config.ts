/**
 * 解析 Edge / Deno Deploy 数据库配置。
 * - 生产（Deno Deploy）：设置 `DATABASE_URL`（postgres://…）→ dialect `pg`
 * - 本地：zhin.config.yml 中 `database:`（默认 sqlite 文件）
 */
export type PlaygroundDatabaseConfig = Record<string, unknown> & {
  dialect: string;
};

export function resolvePlaygroundDatabaseConfig(
  appConfig: Record<string, unknown>,
): PlaygroundDatabaseConfig | null {
  const fromEnv = databaseConfigFromEnv();
  if (fromEnv) return fromEnv;

  const fromFile = appConfig.database as PlaygroundDatabaseConfig | undefined;
  if (fromFile?.dialect) return fromFile;

  return null;
}

function databaseConfigFromEnv(): PlaygroundDatabaseConfig | null {
  const url = (Deno.env.get("DATABASE_URL") ?? Deno.env.get("POSTGRES_URL") ?? "").trim();
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL 不是合法的 URL");
  }

  const scheme = parsed.protocol.replace(/:$/, "");
  if (scheme !== "postgres" && scheme !== "postgresql") {
    throw new Error(
      `DATABASE_URL 协议须为 postgres/postgresql（当前: ${parsed.protocol}）。Edge 上请用托管 PG，勿用 sqlite 文件。`,
    );
  }

  const config: PlaygroundDatabaseConfig = {
    dialect: "pg",
    connectionString: url,
  };

  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode === "require" || sslmode === "verify-full" || sslmode === "verify-ca") {
    config.ssl = { rejectUnauthorized: false };
  }

  const poolMax = Deno.env.get("DATABASE_POOL_MAX");
  if (poolMax) {
    config.pool = { max: Math.max(1, parseInt(poolMax, 10) || 5) };
  }

  return config;
}
