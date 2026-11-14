import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type NormalizedPluginConsoleRpcMethod,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
  type Token,
} from 'zhin.js';
import type { ModerationEngine } from './engine.js';
import { moderationEngineToken } from './runtime.js';

export const MODERATION_CONSOLE_PAGE = 'index';
export const MODERATION_READ_PERMISSION = 'content-moderation:read';

export interface ModerationProviderStatusRow {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly onError: string;
}

export interface ModerationConsoleStatus {
  readonly enabled: boolean;
  readonly sensitivity: string;
  readonly providersCount: number;
  readonly whitelistCount: number;
  readonly pendingReviewsCount: number;
  readonly providers: readonly ModerationProviderStatusRow[];
}

export interface ModerationCheckTextResult {
  readonly passed: boolean;
  readonly decision: 'allow' | 'flag' | 'block';
  readonly severity: string;
  readonly actions: readonly string[];
  readonly categories: readonly string[];
  readonly matchesCount: number;
  readonly message: string;
  /** Matched text fragments (deduplicated, in order). Optional for older callers. */
  readonly hits?: readonly string[];
  /** Sources that flagged the text, with their severity and reason. */
  readonly flaggedSources?: readonly { readonly sourceId: string; readonly severity: string; readonly reason?: string }[];
  /** Localized summaries for the Console page (`$i18n`). */
  readonly decisionI18n?: Readonly<Record<'zh-CN' | 'en', string>>;
  readonly severityI18n?: Readonly<Record<'zh-CN' | 'en', string>>;
  readonly actionsI18n?: Readonly<Record<'zh-CN' | 'en', string>>;
  readonly hitsText?: string;
  readonly sourcesText?: string;
}

const DECISION_LABELS: Readonly<Record<ModerationCheckTextResult['decision'], Readonly<Record<'zh-CN' | 'en', string>>>> = {
  allow: { 'zh-CN': '通过', en: 'Allowed' },
  flag: { 'zh-CN': '标记（不拦截）', en: 'Flagged (not blocked)' },
  block: { 'zh-CN': '拦截', en: 'Blocked' },
};
const SEVERITY_LABELS: Readonly<Record<string, Readonly<Record<'zh-CN' | 'en', string>>>> = {
  pass: { 'zh-CN': '无风险', en: 'None' },
  low: { 'zh-CN': '低', en: 'Low' },
  medium: { 'zh-CN': '中', en: 'Medium' },
  high: { 'zh-CN': '高', en: 'High' },
  critical: { 'zh-CN': '严重', en: 'Critical' },
};
const ACTION_LABELS: Readonly<Record<string, Readonly<Record<'zh-CN' | 'en', string>>>> = {
  allow: { 'zh-CN': '放行', en: 'allow' },
  log: { 'zh-CN': '记录日志', en: 'log' },
  reply: { 'zh-CN': '回复提醒', en: 'reply with a warning' },
  redact: { 'zh-CN': '打码', en: 'redact' },
  drop: { 'zh-CN': '丢弃消息', en: 'drop the message' },
  recall: { 'zh-CN': '撤回消息', en: 'recall the message' },
};

function labelOf(table: Readonly<Record<string, Readonly<Record<'zh-CN' | 'en', string>>>>, key: string) {
  return table[key] ?? { 'zh-CN': key, en: key };
}

type RuntimeWithUse = {
  use?: <T>(token: Token<T>) => T;
};

function resolveEngine(
  call: PluginConsoleRpcCall,
  fallbackEngine?: ModerationEngine,
): ModerationEngine {
  const runtimeWithUse = call.runtime as RuntimeWithUse | undefined;
  if (typeof runtimeWithUse?.use === 'function') {
    try {
      const resolved = runtimeWithUse.use(moderationEngineToken);
      if (resolved) return resolved;
    } catch {
      // Fall back to the plugin setup engine when call.runtime.use is unavailable.
    }
  }
  if (fallbackEngine) return fallbackEngine;
  throw new PluginConsoleRpcError('unavailable', 'Content moderation engine is unavailable');
}

function buildProviderRows(engine: ModerationEngine): ModerationProviderStatusRow[] {
  const configSources = engine.config?.sources ?? [];
  if (configSources.length > 0) {
    return configSources.map((source) => ({
      id: source.id,
      type: source.type,
      enabled: source.enabled,
      onError: source.onError,
    }));
  }
  const activeProviders = engine.providers ?? [];
  return activeProviders.map((provider) => ({
    id: provider.id,
    type: 'custom',
    enabled: true,
    onError: engine.config?.onError ?? 'open',
  }));
}

async function handleCheckText(
  input: PluginConsoleRpcInput,
  call: PluginConsoleRpcCall,
  defaultEngine?: ModerationEngine,
): Promise<PluginConsoleRpcJson> {
  const rawText = input.text;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new PluginConsoleRpcError('invalid_input', 'Sample text is required');
  }
  const text = rawText.trim();
  const engine = resolveEngine(call, defaultEngine);
  const evaluation = typeof engine.moderate === 'function'
    ? await engine.moderate({ text, direction: 'inbound' })
    : await engine.scan({
        text,
        images: [],
        direction: 'inbound',
        context: {
          adapter: 'console',
          endpoint: 'dry-run',
          conversationKind: 'private',
          conversationId: 'dry-run',
        },
      });

  const severity = evaluation.severity;
  const actions = ('actions' in evaluation && Array.isArray(evaluation.actions))
    ? evaluation.actions
    : (engine.config?.actions?.[severity] ?? []);
  const passed = severity === 'pass';
  const decision: ModerationCheckTextResult['decision'] = passed
    ? 'allow'
    : (actions.includes('drop') || actions.includes('recall') ? 'block' : 'flag');
  const categories = (evaluation.sources ?? [])
    .filter((source) => source.severity !== 'pass')
    .map((source) => `${source.sourceId}:${source.severity}`);
  const matchesCount = evaluation.matches?.length ?? 0;
  const hits = [...new Set((evaluation.matches ?? [])
    .map((match) => text.slice(Math.max(0, match.start), Math.max(0, match.end)))
    .filter((hit) => hit.length > 0))];
  const flaggedSources = (evaluation.sources ?? [])
    .filter((source) => source.severity !== 'pass')
    .map((source) => ({
      sourceId: source.sourceId,
      severity: source.severity,
      ...(source.reason ? { reason: source.reason } : {}),
    }));
  const join = (locale: 'zh-CN' | 'en', values: readonly string[]) => values.join(locale === 'en' ? ', ' : '、');
  const actionsI18n = {
    'zh-CN': actions.length ? join('zh-CN', actions.map((action) => labelOf(ACTION_LABELS, action)['zh-CN'])) : '无',
    en: actions.length ? join('en', actions.map((action) => labelOf(ACTION_LABELS, action).en)) : 'none',
  };
  const sourcesText = flaggedSources
    .map((source) => `${source.sourceId}（${source.severity}${source.reason ? `：${source.reason}` : ''}）`)
    .join('、');

  return {
    passed,
    decision,
    severity,
    actions: [...actions],
    categories,
    matchesCount,
    hits,
    flaggedSources,
    decisionI18n: DECISION_LABELS[decision],
    severityI18n: labelOf(SEVERITY_LABELS, severity),
    actionsI18n,
    hitsText: hits.join('、'),
    sourcesText,
    message: passed
      ? 'Passed moderation check (allow)'
      : `Moderation decision: ${decision} (severity: ${severity}, matches: ${matchesCount})`,
  } as unknown as PluginConsoleRpcJson;
}

export function createModerationConsoleRpc(
  defaultEngine?: ModerationEngine,
): PluginConsoleRpc {
  const checkMethod = {
    page: MODERATION_CONSOLE_PAGE,
    requiredPermissions: [MODERATION_READ_PERMISSION],
    handler: (input: PluginConsoleRpcInput, call: PluginConsoleRpcCall) =>
      handleCheckText(input, call, defaultEngine),
  };

  const rpc = definePluginConsoleRpc({
    status: {
      page: MODERATION_CONSOLE_PAGE,
      requiredPermissions: [MODERATION_READ_PERMISSION],
      handler(_input, call): PluginConsoleRpcJson {
        const engine = resolveEngine(call, defaultEngine);
        const config = engine.config;
        const providers = buildProviderRows(engine);
        const whitelistCount =
          (config?.inbound?.whitelist?.userIds?.length ?? 0) +
          (config?.inbound?.whitelist?.conversationIds?.length ?? 0);
        const pendingReviewsCount =
          engine.pendingReviewsCount ?? engine.groupReviewQueue?.pendingCount ?? 0;

        return {
          enabled: Boolean(config?.enabled ?? true),
          sensitivity: engine.sensitivity ?? (config?.onError === 'closed' ? 'strict' : 'medium'),
          providersCount: providers.length,
          whitelistCount,
          pendingReviewsCount,
          providers: providers as unknown as PluginConsoleRpcJson,
        };
      },
    },
    actions: {
      'check-text': checkMethod,
    },
  });

  // Alias `checkText` on get/has while keeping `methods.keys()` strictly kebab-case.
  const methods = rpc.methods as Map<string, NormalizedPluginConsoleRpcMethod>;
  const origGet = methods.get.bind(methods);
  const origHas = methods.has.bind(methods);
  const normalizeKey = (key: string): string => (key === 'checkText' ? 'check-text' : key);
  methods.get = (key: string) => origGet(normalizeKey(key));
  methods.has = (key: string) => origHas(normalizeKey(key));

  return rpc;
}
