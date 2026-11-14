import { Schema } from 'zhin.js';

/** Authoring declaration; scripts/sync-plugin-config-schemas.mjs generates the packaged schema.json for Runtime and Console. */
export const codeRunnerConfig = Schema.object({
  provider: Schema.union([
    Schema.const('piston'),
    Schema.const('glot'),
  ])
    .default('piston')
    .description('代码运行后端协议：piston（自建 Piston 的 /api/v2/execute）或 glot（glot.io 兼容的 /api/run）')
    .i18n({ en: { description: 'Backend protocol: piston (a self-hosted Piston /api/v2/execute) or glot (a glot.io-compatible /api/run).' } })
    .effect('reload')
    .fieldLevels(['global']),
  endpoint: Schema.string()
    .default('')
    .description('代码运行后端地址。piston 填完整执行地址（如 http://127.0.0.1:2000/api/v2/execute）；glot 填 run 前缀（如 https://glot.io/api/run）。留空时命令提示未配置；可写 ${CODE_RUNNER_ENDPOINT}')
    .i18n({ en: { description: 'Backend URL. For piston, the full execute URL (e.g. http://127.0.0.1:2000/api/v2/execute); for glot, the run prefix (e.g. https://glot.io/api/run). Empty means not configured. ${CODE_RUNNER_ENDPOINT} is supported.' } })
    .effect('reload')
    .fieldLevels(['global']),
  token: Schema.string()
    .secret()
    .description('后端访问令牌（可选），建议写 ${CODE_RUNNER_TOKEN}。piston 作为 Authorization 头原样发送，glot 发送 Authorization: Token <token>')
    .i18n({ en: { description: 'Optional backend token; prefer ${CODE_RUNNER_TOKEN}. Sent as the raw Authorization header for piston and as "Authorization: Token <token>" for glot.' } })
    .effect('reload')
    .fieldLevels(['global']),
});

export type CodeRunnerConfig = Schema.Output<typeof codeRunnerConfig>;

export interface CodeRunnerBackend {
  readonly provider: 'piston' | 'glot';
  readonly endpoint: string;
  readonly token?: string;
}

/** Missing or blank fields mean "not configured"; never fall back to a hard-coded public service. */
export function resolveCodeRunnerBackend(config: Partial<CodeRunnerConfig> | undefined): CodeRunnerBackend | undefined {
  const endpoint = typeof config?.endpoint === 'string' ? config.endpoint.trim() : '';
  // An unexpanded `${ENV}` reference means the variable is missing: treat it as unconfigured.
  if (!endpoint || /^\$\{[^}]*\}$/u.test(endpoint)) return undefined;
  const token = typeof config?.token === 'string' && config.token.trim() && !/^\$\{[^}]*\}$/u.test(config.token.trim())
    ? config.token.trim()
    : undefined;
  return { provider: config?.provider === 'glot' ? 'glot' : 'piston', endpoint, ...(token ? { token } : {}) };
}
