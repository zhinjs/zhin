import inquirer from 'inquirer';
import {
  ADAPTERS,
  buildFieldBasedInstanceConfig,
  buildRuntimeConfigDocument,
  configureAdapters,
  configureAI,
  configureDatabaseOptions,
  ensureDatabaseForAdapters,
  ensureDatabaseForAI,
  getDatabaseDialectDefinition,
  type AdapterSetupResult,
  type DatabaseConfig,
  type InitOptions,
} from '@zhin.js/scaffold-wizard';
import type { CreateArgs } from './args.js';
import { createText, type CreateLocale } from './messages.js';
import { applyCreateDefaults } from './stable-yes-defaults.js';
import { generateToken, isValidProjectName } from './utils.js';

export const DEFAULT_PROJECT_NAME = 'my-zhin-bot';
export const CONSOLE_URL = 'https://console.zhin.dev/';

type PromptQuestion = Record<string, unknown> & { name: string };
export type PromptFn = (questions: PromptQuestion[]) => Promise<Record<string, unknown>>;

/** Injected so tests can record which questions are asked. */
export interface CreateFlowDeps {
  readonly prompt: PromptFn;
  readonly configureDatabase: (locale: CreateLocale) => Promise<DatabaseConfig>;
  readonly configureAdapters: (locale: CreateLocale) => Promise<AdapterSetupResult>;
  readonly configureAI: (locale: CreateLocale) => Promise<NonNullable<InitOptions['ai']>>;
  readonly generateToken: () => string;
}

export const defaultCreateFlowDeps: CreateFlowDeps = {
  prompt: (questions) => inquirer.prompt(questions as never) as Promise<Record<string, unknown>>,
  configureDatabase: configureDatabaseOptions,
  configureAdapters,
  configureAI,
  generateToken: () => generateToken(16),
};

function schemaDefaults(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const [key, property] of Object.entries(properties)) {
    if (key === 'dialect') continue;
    if ('default' in property) out[key] = property.default;
    else if (property.type === 'object') out[key] = schemaDefaults(property);
    else if (key === 'password') out[key] = '';
  }
  return out;
}

/** Non-interactive `--database <dialect>`: the dialect's documented defaults. */
export function databaseDefaults(dialect: DatabaseConfig['dialect']): DatabaseConfig {
  const definition = getDatabaseDialectDefinition(dialect);
  if (!definition) throw new TypeError(`Unknown database dialect: ${dialect}`);
  return { dialect, ...schemaDefaults(definition.schema as Record<string, unknown>) };
}

/**
 * Non-interactive `--adapter <name>`: Sandbox and field-based adapters use their
 * defaults (secrets become `${ENV}` references with empty `.env` values);
 * adapters with a dedicated configurer keep their own credential questions.
 */
export async function buildAdapterSetup(values: readonly string[], locale: CreateLocale): Promise<AdapterSetupResult> {
  const result: AdapterSetupResult = { packages: [], plugins: [], instances: [], envVars: {}, requiresDatabase: false };
  for (const value of values) {
    const adapter = ADAPTERS.find((entry) => entry.value === value);
    if (!adapter) throw new TypeError(`Unknown adapter: ${value}`);
    result.packages.push(adapter.package);
    for (const [pkg, version] of Object.entries(adapter.extraDeps ?? {})) result.packages.push(`${pkg}@${version}`);
    result.plugins.push(adapter.plugin);
    if (adapter.requiresDatabase) result.requiresDatabase = true;

    let config: Record<string, unknown>;
    if (adapter.value === 'sandbox') {
      config = { commandPrefix: '/', endpoints: [{ id: 'sandbox-bot', owner: 'sandbox-user' }] };
    } else if (adapter.configure) {
      config = await adapter.configure({
        envVars: result.envVars,
        locale,
        markRequiresDatabase: () => { result.requiresDatabase = true; },
      });
    } else if (adapter.fields.length > 0) {
      const fieldValues: Record<string, unknown> = {};
      for (const field of adapter.fields) {
        if (field.envKey) {
          result.envVars[field.envKey] = field.default ?? '';
          fieldValues[field.key] = `\${${field.envKey}}`;
        } else if (field.default !== undefined) {
          fieldValues[field.key] = field.default;
        }
      }
      config = buildFieldBasedInstanceConfig(adapter, fieldValues);
    } else {
      config = {};
    }
    result.instances.push({ package: adapter.package, instanceKey: adapter.value, config });
  }
  return result;
}

export interface ResolvedCreate {
  readonly name: string;
  readonly options: InitOptions;
}

/**
 * ADR 0053 §1: the only questions are project name and bootstrap token (language
 * is asked before this, by `configureProjectLocale`). Everything else takes a
 * default unless a flag asked for it; `-y` accepts the defaults without asking.
 */
export async function resolveCreateOptions(
  args: CreateArgs,
  locale: CreateLocale,
  deps: CreateFlowDeps = defaultCreateFlowDeps,
): Promise<ResolvedCreate> {
  const options: InitOptions = {
    locale,
    yes: args.yes,
    template: args.template,
    config: args.configFormat,
    devSkills: args.devSkills,
  };

  let name = args.projectName;
  if (name === undefined && !args.yes) {
    const answer = await deps.prompt([{
      type: 'input',
      name: 'projectName',
      message: createText(locale, 'create.prompt.projectName'),
      default: DEFAULT_PROJECT_NAME,
      validate: (input: string) => {
        if (!input.trim()) return createText(locale, '项目名称不能为空');
        return isValidProjectName(input.trim()) || createText(locale, '项目名称只能包含字母、数字、横线和下划线');
      },
    }]);
    name = String(answer.projectName).trim();
  }
  name ??= DEFAULT_PROJECT_NAME;
  if (!isValidProjectName(name)) throw new TypeError(createText(locale, '项目名称只能包含字母、数字、横线和下划线'));

  const defaultToken = deps.generateToken();
  if (args.yes) {
    options.httpToken = defaultToken;
  } else {
    const answer = await deps.prompt([{
      type: 'input',
      name: 'token',
      message: createText(locale, 'create.prompt.bootstrapToken'),
      default: defaultToken,
      validate: (input: string) => input.trim() ? true : createText(locale, 'create.error.tokenEmpty'),
    }]);
    options.httpToken = String(answer.token).trim();
  }

  // Optional steps only run when their flag was passed; otherwise the Console onboarding owns them.
  if (args.database === 'interactive') options.database = await deps.configureDatabase(locale);
  else if (args.database) options.database = databaseDefaults(args.database);

  if (args.adapters === 'interactive') options.adapters = await deps.configureAdapters(locale);
  else if (args.adapters?.length) options.adapters = await buildAdapterSetup(args.adapters, locale);

  if (args.ai) options.ai = await deps.configureAI(locale);

  if (options.ai?.enabled) ensureDatabaseForAI(options);
  if (options.adapters) ensureDatabaseForAdapters(options);

  applyCreateDefaults(options);
  return { name, options };
}

/**
 * Console API base from the generated config (`http.port` + `http.base`).
 * The Console appends `/api/...` to this value itself, so the trailing `/api`
 * segment of `http.base` is not repeated here (`/api` → origin only).
 */
export function resolveConsoleApiBaseUrl(options: InitOptions): string {
  const http = (buildRuntimeConfigDocument(options).http ?? {}) as { host?: unknown; port?: unknown; base?: unknown };
  const host = typeof http.host === 'string' && http.host && http.host !== '0.0.0.0' && http.host !== '::' ? http.host : '127.0.0.1';
  const base = typeof http.base === 'string' ? http.base.replace(/\/+$/u, '').replace(/\/api$/u, '') : '';
  return `http://${host}:${String(http.port)}${base}`;
}

/**
 * Console link in its existing format: `?apiBaseUrl=` (URL-encoded) and the token
 * only after `#`, so it never reaches console.zhin.dev's server.
 */
export function buildConsoleSetupLink(apiBaseUrl: string, token?: string): string {
  const url = `${CONSOLE_URL}?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;
  return token ? `${url}#token=${encodeURIComponent(token)}` : url;
}

export interface CreateSummaryInput {
  readonly locale: CreateLocale;
  readonly projectName: string;
  readonly skipInstall: boolean;
  readonly options: InitOptions;
  /** The token is printed only to an interactive terminal (not CI logs). */
  readonly interactiveTerminal: boolean;
}

export function renderCreateSummary(input: CreateSummaryInput): string[] {
  const { locale, projectName, skipInstall, options } = input;
  const start = skipInstall ? `cd ${projectName} && pnpm install && pnpm dev` : `cd ${projectName} && pnpm dev`;
  const apiBaseUrl = resolveConsoleApiBaseUrl(options);
  const showToken = input.interactiveTerminal && Boolean(options.httpToken);
  const lines = [
    createText(locale, 'create.done.created', [projectName]),
    createText(locale, 'create.done.start', [start]),
    createText(locale, 'create.done.openConsole'),
    `  ${buildConsoleSetupLink(apiBaseUrl, showToken ? options.httpToken : undefined)}`,
  ];
  if (!showToken) lines.push(createText(locale, 'create.done.tokenHidden'));
  lines.push(
    '',
    createText(locale, 'create.done.tokenNote'),
    createText(locale, 'create.done.consoleSteps'),
    createText(locale, 'create.done.doctor', ['npx zhin doctor']),
    createText(locale, 'create.done.docs', [locale === 'en' ? 'https://zhin.js.org/en/' : 'https://zhin.js.org']),
  );
  return lines;
}
