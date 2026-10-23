/**
 * Reads the evaluated workspace: its zhin.config.yml (with ${VAR} references resolved from the
 * workspace .env and the process environment), the agent binding and the LLM providers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { createLlmApiRuntime, type LlmApiRuntime, type Model } from '../../../packages/im/ai/src/index.js';

export interface EvalWorkspace {
  readonly dir: string;
  readonly runtime: LlmApiRuntime;
  /** `providerAlias/model` of the evaluated agent. */
  readonly agentModel: string;
  readonly nickname?: string;
  model(ref: string): Model;
}

/** `.env` lines may be written `KEY = value`; quotes are stripped, comments ignored. */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

/** Replace `${VAR}` in every string of a parsed YAML value; unknown variables become ''. */
export function resolveEnvReferences<T>(value: T, env: Record<string, string | undefined>): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => env[name] ?? '') as T;
  }
  if (Array.isArray(value)) return value.map(item => resolveEnvReferences(item, env)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveEnvReferences(item, env)])) as T;
  }
  return value;
}

interface AgentBindingConfig {
  readonly provider?: string;
  readonly model?: string;
  readonly nickname?: string;
}

export function loadEvalWorkspace(dir: string, agentName?: string): EvalWorkspace {
  const configPath = join(dir, 'zhin.config.yml');
  if (!existsSync(configPath)) throw new Error(`No zhin.config.yml in ${dir}`);
  const envPath = join(dir, '.env');
  const env = { ...(existsSync(envPath) ? parseDotEnv(readFileSync(envPath, 'utf8')) : {}), ...process.env };
  const config = resolveEnvReferences(parse(readFileSync(configPath, 'utf8')) as Record<string, any>, env);
  const providers = (config.ai?.providers ?? {}) as Record<string, Record<string, unknown> & { models?: string[] }>;
  const agents = (config.ai?.agents ?? {}) as Record<string, AgentBindingConfig>;
  const name = agentName ?? (agents.zhin ? 'zhin' : Object.keys(agents)[0]);
  const binding = name ? agents[name] : undefined;
  if (!binding?.provider || !binding.model) throw new Error(`ai.agents.${name ?? '<none>'} needs provider and model`);

  const entries = Object.entries(providers).map(([alias, providerConfig]) => ({
    alias,
    config: { ...providerConfig, maxRetries: 1 } as never,
    // An empty list accepts any model id; evaluation runs name models explicitly.
    models: [] as string[],
    fetch: globalThis.fetch,
  }));
  const runtime = createLlmApiRuntime(entries, () => []);
  return {
    dir,
    runtime,
    agentModel: `${binding.provider}/${binding.model}`,
    ...(binding.nickname ? { nickname: binding.nickname } : {}),
    model(ref: string): Model {
      const [alias, ...model] = ref.split('/');
      if (!alias || model.length === 0) throw new Error(`Model reference must be providerAlias/model: ${ref}`);
      return runtime.model(alias, model.join('/'));
    },
  };
}
