import {
  isAction,
  type Action,
  type HttpSourceConfig,
  type LocalSourceConfig,
  type ModerationConfig,
  type OnErrorPolicy,
  type Severity,
  type SourceConfig,
} from './types.js';

export const DEFAULT_ACTIONS: Readonly<Record<Severity, readonly Action[]>> = Object.freeze({
  pass: Object.freeze(['allow'] as const),
  low: Object.freeze(['log'] as const),
  medium: Object.freeze(['redact'] as const),
  high: Object.freeze(['drop'] as const),
  critical: Object.freeze(['drop', 'recall'] as const),
});

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = Object.freeze({
  enabled: true,
  onError: 'open',
  maskChar: '*',
  replyTemplate: '消息含不当内容，已拦截。',
  masters: Object.freeze([] as string[]),
  inbound: Object.freeze({
    enabled: true,
    bypassMasters: true,
    whitelist: Object.freeze({
      userIds: Object.freeze([] as string[]),
      conversationIds: Object.freeze([] as string[]),
    }),
  }),
  outbound: Object.freeze({
    enabled: true,
    bypass: false,
  }),
  actions: DEFAULT_ACTIONS,
  sources: Object.freeze([] as SourceConfig[]),
});

export function resolveModerationConfig(raw: unknown): ModerationConfig {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const inboundRaw = asRecord(input.inbound);
  const outboundRaw = asRecord(input.outbound);
  const whitelistRaw = asRecord(inboundRaw.whitelist);
  const onError = parseOnError(input.onError, DEFAULT_MODERATION_CONFIG.onError);
  const maskChar = typeof input.maskChar === 'string' && input.maskChar.length > 0
    ? input.maskChar.slice(0, 4)
    : DEFAULT_MODERATION_CONFIG.maskChar;
  const replyTemplate = typeof input.replyTemplate === 'string' && input.replyTemplate.length > 0
    ? input.replyTemplate
    : DEFAULT_MODERATION_CONFIG.replyTemplate;

  return Object.freeze({
    enabled: input.enabled !== false,
    onError,
    maskChar,
    replyTemplate,
    masters: freezeStrings(input.masters),
    inbound: Object.freeze({
      enabled: inboundRaw.enabled !== false,
      bypassMasters: inboundRaw.bypassMasters !== false,
      whitelist: Object.freeze({
        userIds: freezeStrings(whitelistRaw.userIds),
        conversationIds: freezeStrings(whitelistRaw.conversationIds),
      }),
    }),
    outbound: Object.freeze({
      enabled: outboundRaw.enabled !== false,
      bypass: outboundRaw.bypass === true,
    }),
    actions: resolveActions(input.actions),
    sources: Object.freeze(
      (Array.isArray(input.sources) ? input.sources : [])
        .map((item) => parseSource(item, onError))
        .filter((item): item is SourceConfig => item != null),
    ),
  });
}

function resolveActions(raw: unknown): Readonly<Record<Severity, readonly Action[]>> {
  const input = asRecord(raw);
  return Object.freeze({
    pass: resolveActionList(input.pass, DEFAULT_ACTIONS.pass),
    low: resolveActionList(input.low, DEFAULT_ACTIONS.low),
    medium: resolveActionList(input.medium, DEFAULT_ACTIONS.medium),
    high: resolveActionList(input.high, DEFAULT_ACTIONS.high),
    critical: resolveActionList(input.critical, DEFAULT_ACTIONS.critical),
  });
}

function resolveActionList(raw: unknown, fallback: readonly Action[]): readonly Action[] {
  if (typeof raw === 'string' && isAction(raw)) return Object.freeze([raw]);
  if (Array.isArray(raw)) {
    const actions = raw.filter(isAction);
    if (actions.length > 0) return Object.freeze([...actions]);
  }
  return fallback;
}

function parseSource(raw: unknown, globalOnError: OnErrorPolicy): SourceConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id) return null;
  const enabled = input.enabled !== false;
  const onError = parseOnError(input.onError, globalOnError);

  if (input.type === 'local') {
    const defaultSeverity = parseHitSeverity(input.defaultSeverity ?? input.severity);
    const local: LocalSourceConfig = Object.freeze({
      id,
      type: 'local',
      enabled,
      onError,
      words: freezeLexiconWords(input.words, defaultSeverity),
      wordFiles: freezeStrings(input.wordFiles),
      includeBuiltin: input.includeBuiltin !== false,
      defaultSeverity,
    });
    return local;
  }

  if (input.type === 'http') {
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (!url) return null;
    const headersRaw = asRecord(input.headers);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(headersRaw)) {
      if (typeof value === 'string') headers[key] = value;
    }
    const timeoutMs = clampNumber(input.timeoutMs, 5_000, 500, 60_000);
    const http: HttpSourceConfig = Object.freeze({
      id,
      type: 'http',
      enabled,
      onError,
      url,
      headers: Object.freeze(headers),
      timeoutMs,
      forceUpload: input.forceUpload === true,
    });
    return http;
  }

  return null;
}

function parseHitSeverity(raw: unknown): Exclude<Severity, 'pass'> {
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'critical') return raw;
  return 'high';
}

function parseOnError(raw: unknown, fallback: OnErrorPolicy): OnErrorPolicy {
  return raw === 'open' || raw === 'closed' ? raw : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function freezeStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.filter((item): item is string => typeof item === 'string' && item.length > 0),
  );
}

function freezeLexiconWords(
  value: unknown,
  defaultSeverity: Exclude<Severity, 'pass'>,
): LocalSourceConfig['words'] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const out: LocalSourceConfig['words'][number][] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const word = item.trim();
      if (word) out.push(Object.freeze({ word, severity: defaultSeverity }));
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const word = typeof record.word === 'string'
      ? record.word.trim()
      : typeof record.text === 'string'
        ? record.text.trim()
        : '';
    if (!word) continue;
    out.push(Object.freeze({
      word,
      severity: parseHitSeverity(record.severity ?? defaultSeverity),
    }));
  }
  return Object.freeze(out);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
