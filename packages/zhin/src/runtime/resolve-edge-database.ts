import type { AppConfig } from '../types.js';

export type EdgeDatabaseConfig = Record<string, unknown> & {
  dialect: string;
};

function envGet(key: string): string | undefined {
  const g = globalThis as {
    Deno?: { env: { get: (k: string) => string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  return g.Deno?.env.get(key) ?? g.process?.env[key];
}

function databaseConfigFromEnv(): EdgeDatabaseConfig | null {
  const url = (envGet('DATABASE_URL') ?? envGet('POSTGRES_URL') ?? '').trim();
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL 不是合法的 URL');
  }

  const scheme = parsed.protocol.replace(/:$/, '');
  if (scheme !== 'postgres' && scheme !== 'postgresql') {
    throw new Error(
      `DATABASE_URL 协议须为 postgres/postgresql（当前: ${parsed.protocol}）。Edge 上请用托管 PG，勿用 sqlite 文件。`,
    );
  }

  const config: EdgeDatabaseConfig = {
    dialect: 'pg',
    connectionString: url,
  };

  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode === 'require' || sslmode === 'verify-full' || sslmode === 'verify-ca') {
    config.ssl = { rejectUnauthorized: false };
  }

  const poolMax = envGet('DATABASE_POOL_MAX');
  if (poolMax) {
    config.pool = { max: Math.max(1, parseInt(poolMax, 10) || 5) };
  }

  return config;
}

export function resolveEdgeDatabaseConfig(appConfig: AppConfig): EdgeDatabaseConfig | null {
  const fromEnv = databaseConfigFromEnv();
  if (fromEnv) return fromEnv;

  const fromFile = appConfig.database as EdgeDatabaseConfig | undefined;
  if (fromFile?.dialect) return fromFile;

  return null;
}
