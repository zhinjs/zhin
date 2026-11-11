/**
 * One-shot connection probe for setup wizards: connect, run the dialect health query, disconnect.
 * Error text is stripped of credentials before it is returned.
 */

export type ProbeDialect = 'sqlite' | 'mysql' | 'pg' | 'mongodb';

export interface DatabaseProbeResult {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

interface ProbeTarget {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

/** Driver package that must be importable for each dialect (`null`: built into Node). */
export const DATABASE_DRIVER_PACKAGES: Readonly<Record<ProbeDialect, string | null>> = Object.freeze({
  sqlite: null,
  mysql: 'mysql2',
  pg: 'pg',
  mongodb: 'mongodb',
});

/** Whether the optional driver package for `dialect` can be loaded. */
export async function isDatabaseDriverAvailable(
  dialect: ProbeDialect,
  importer: (specifier: string) => Promise<unknown> = specifier => import(specifier),
): Promise<boolean> {
  const pkg = DATABASE_DRIVER_PACKAGES[dialect];
  if (pkg === null) return true;
  try {
    await importer(pkg);
    return true;
  } catch {
    return false;
  }
}

async function createProbeTarget(dialect: ProbeDialect, config: Record<string, unknown>): Promise<ProbeTarget> {
  switch (dialect) {
    case 'sqlite': {
      const { SQLiteDialect } = await import('./dialects/sqlite.js');
      return new SQLiteDialect(config as never) as unknown as ProbeTarget;
    }
    case 'mysql': {
      const { MySQLDialect } = await import('./dialects/mysql.js');
      return new MySQLDialect(config as never) as unknown as ProbeTarget;
    }
    case 'pg': {
      const { PostgreSQLDialect } = await import('./dialects/pg.js');
      return new PostgreSQLDialect(config as never) as unknown as ProbeTarget;
    }
    case 'mongodb': {
      const { MongoDBDialect } = await import('./dialects/mongodb.js');
      return new MongoDBDialect(config as never) as unknown as ProbeTarget;
    }
    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }
}

/**
 * Opens a temporary connection with `config` and closes it again.
 * `factory` is a test seam; it defaults to the built-in dialects.
 */
export async function probeDatabaseConnection(
  dialect: ProbeDialect,
  config: Record<string, unknown>,
  options: Readonly<{
    timeoutMs?: number;
    factory?: (dialect: ProbeDialect, config: Record<string, unknown>) => Promise<ProbeTarget>;
  }> = {},
): Promise<DatabaseProbeResult> {
  const secrets = collectSecrets(config);
  const startedAt = Date.now();
  let target: ProbeTarget | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('connection timed out')), options.timeoutMs ?? 10_000);
  });
  try {
    target = await (options.factory ?? createProbeTarget)(dialect, config);
    await Promise.race([target.connect(), timeout]);
    const healthy = await Promise.race([target.healthCheck(), timeout]);
    if (!healthy) return Object.freeze({ ok: false, error: 'probe query failed' });
    return Object.freeze({ ok: true, latencyMs: Date.now() - startedAt });
  } catch (error) {
    return Object.freeze({ ok: false, error: redactProbeError(error, secrets) });
  } finally {
    clearTimeout(timer);
    await target?.disconnect().catch(() => undefined);
  }
}

function collectSecrets(config: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || !value) continue;
    if (/pass|secret|token|key/iu.test(key)) values.push(value);
    if (/url|uri|connectionString/iu.test(key)) {
      const credentials = /\/\/([^@/]*)@/u.exec(value)?.[1];
      if (credentials) values.push(credentials, ...credentials.split(':').filter(Boolean));
    }
  }
  return values.filter(value => value.length >= 3).sort((a, b) => b.length - a.length);
}

/** Removes credentials (configured secret values, URL userinfo) from a driver error. */
export function redactProbeError(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) message = message.split(secret).join('***');
  message = message.replace(/\/\/[^@\s/]*@/gu, '//***@');
  message = message.replace(/(password|pwd)\s*[=:]\s*\S+/giu, '$1=***');
  return message.slice(0, 300);
}
