export interface PageMetadata {
  readonly title?: string;
  /** Explicit display titles; missing locales retain title. */
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly icon?: string;
  readonly order?: number;
  readonly hideInNav?: boolean;
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
}

export interface NormalizedPageMetadata {
  readonly title: string;
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly icon?: string;
  readonly order: number;
  readonly hideInNav: boolean;
  readonly requiredPermissions: readonly string[];
  readonly requiredRoles: readonly string[];
}

export interface ClientModuleArtifact {
  readonly module: string;
  readonly hash: string;
  readonly metadata?: unknown;
  readonly blueprint?: ConsolePageBlueprint | ConsoleAdapterPageBlueprint;
}

export function normalizeClientModuleArtifact(
  value: unknown,
  label: string,
): Readonly<ClientModuleArtifact> {
  const input = requireRecord(value, label);
  const module = optionalString(input.module, `${label} module`);
  const hash = optionalString(input.hash, `${label} hash`);
  if (!module || !hash) throw new TypeError(`${label} must include module and hash`);
  const blueprint = isConsoleBlueprint(input.blueprint) ? input.blueprint : undefined;
  return Object.freeze({
    module,
    hash,
    metadata: input.metadata,
    ...(blueprint !== undefined ? { blueprint } : {}),
  });
}

export function isConsoleBlueprint(
  value: unknown,
): value is ConsolePageBlueprint | ConsoleAdapterPageBlueprint {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === 'zhin.console.page-blueprint' || kind === 'zhin.console.adapter-page';
}

export interface PageManifest extends NormalizedPageMetadata {
  readonly id: string;
  readonly owner: string;
  readonly localName: string;
  readonly source: string;
  readonly module: string;
  readonly hash: string;
  readonly route: string;
  readonly blueprint?: ConsolePageBlueprint | ConsoleAdapterPageBlueprint;
}

export function definePage(metadata: PageMetadata = {}): Readonly<PageMetadata> {
  return normalizePageInput(metadata);
}

export function normalizePageMetadata(
  localName: string,
  metadata: unknown,
): Readonly<NormalizedPageMetadata> {
  assertPageLocalName(localName);
  const input = metadata === undefined ? {} : requireRecord(metadata, 'Page metadata');
  assertKnownMetadataKeys(input);
  const title = optionalString(input.title, 'Page title') ?? titleFromName(localName);
  const titleI18n = pageTitleTranslations(input.titleI18n);
  const icon = optionalString(input.icon, 'Page icon');
  const order = optionalNumber(input.order, 'Page order') ?? 100;
  const hideInNav = optionalBoolean(input.hideInNav, 'Page hideInNav') ?? false;
  return Object.freeze({
    title,
    ...(titleI18n === undefined ? {} : { titleI18n }),
    icon,
    order,
    hideInNav,
    requiredPermissions: stringList(input.requiredPermissions, 'Page requiredPermissions'),
    requiredRoles: stringList(input.requiredRoles, 'Page requiredRoles'),
  });
}

function assertKnownMetadataKeys(input: Record<string, unknown>): void {
  const known = new Set([
    'title',
    'titleI18n',
    'icon',
    'order',
    'hideInNav',
    'requiredPermissions',
    'requiredRoles',
  ]);
  const unknown = Object.keys(input).filter((key) => !known.has(key)).sort();
  if (unknown.length > 0) throw new TypeError(`Unknown Page metadata: ${unknown.join(', ')}`);
}

export function pageRoute(owner: string, root: string, localName: string): string {
  assertPageLocalName(localName);
  if (owner !== root && !owner.startsWith(`${root}/`)) {
    throw new Error(`Page owner ${owner} is outside Root ${root}`);
  }
  const relative = owner === root ? '' : owner.slice(root.length + 1);
  // `pages/index/index.tsx` maps to the plugin path itself (e.g. sandbox → `/sandbox`),
  // so demos can open the chat UI without the `/p-` leaf segment.
  if (localName === 'index') {
    return relative ? `/${relative}` : '/';
  }
  return `/${relative ? `${relative}/` : ''}p-${localName}`;
}

export function assertPageLocalName(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new TypeError(`Invalid Page local name: ${value}`);
  }
}

function normalizePageInput(metadata: PageMetadata): Readonly<PageMetadata> {
  const normalized = normalizePageMetadata('page', metadata);
  return Object.freeze({
    title: metadata.title === undefined ? undefined : normalized.title,
    ...(normalized.titleI18n === undefined ? {} : { titleI18n: normalized.titleI18n }),
    icon: normalized.icon,
    order: metadata.order === undefined ? undefined : normalized.order,
    hideInNav: metadata.hideInNav === undefined ? undefined : normalized.hideInNav,
    requiredPermissions: normalized.requiredPermissions,
    requiredRoles: normalized.requiredRoles,
  });
}

function titleFromName(name: string): string {
  return name.split('-').map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function stringList(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new TypeError(`${label} entries must be non-empty strings`);
    return item;
  });
  return Object.freeze([...new Set(result)].sort());
}

function pageTitleTranslations(value: unknown): NormalizedPageMetadata['titleI18n'] {
  if (value === undefined) return undefined;
  const input = requireRecord(value, 'Page titleI18n');
  const output: Partial<Record<'zh-CN' | 'en', string>> = {};
  for (const [locale, title] of Object.entries(input)) {
    if (locale !== 'zh-CN' && locale !== 'en') throw new TypeError(`Unsupported Page titleI18n locale: ${locale}`);
    const text = optionalString(title, `Page titleI18n.${locale}`);
    if (text === undefined) throw new TypeError(`Page titleI18n.${locale} must be a non-empty string`);
    output[locale] = text;
  }
  return Object.freeze(output);
}

// ── Server-Driven Page Blueprint & Declarative Page Contracts ──────────────

export type DeclarativeI18nText =
  | string
  | { readonly zh: string; readonly en?: string; readonly 'zh-CN'?: string };

export type DeclarativeBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type DeclarativeButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type DeclarativeUiLocale = 'zh-CN' | 'en';
/** Framework-agnostic renderable value (string, number, boolean, null, undefined, or JSX/ReactNode in browser). */
export type DeclarativeRenderable = unknown;

/**
 * Pure JSON-serializable expression descriptor for zero-closure Server-Driven Blueprints.
 * Can be evaluated identically in Web Console, IM Card projection, and CLI TUI panels.
 */
export type DeclarativeValueExpr =
  | { readonly $path: string; readonly fallback?: string | number | boolean }
  | { readonly $count: string }
  | { readonly $sum: { readonly path: string; readonly field: string } }
  | { readonly $format: DeclarativeI18nText; readonly args: readonly string[] }
  | {
      readonly $map: {
        readonly path: string;
        readonly cases: Readonly<Record<string, DeclarativeI18nText>>;
        readonly default?: DeclarativeI18nText;
      };
    }
  | {
      readonly $join: {
        readonly path: string;
        readonly sep?: string;
        readonly empty?: DeclarativeI18nText;
      };
    }
  | { readonly $coalesce: readonly string[]; readonly fallback?: string | number | boolean };

export function isDeclarativeValueExpr(value: unknown): value is DeclarativeValueExpr {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.$path === 'string' ||
    typeof rec.$count === 'string' ||
    (rec.$sum !== null && typeof rec.$sum === 'object') ||
    (rec.$format !== undefined && Array.isArray(rec.$args ?? rec.args)) ||
    (rec.$map !== null && typeof rec.$map === 'object') ||
    (rec.$join !== null && typeof rec.$join === 'object') ||
    Array.isArray(rec.$coalesce)
  );
}

export function resolveDataPath(data: unknown, path: string): unknown {
  if (!data || typeof data !== 'object' || !path) return undefined;
  const record = data as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, path)) return record[path];
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = data;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor) && seg === 'length') return cursor.length;
    if (typeof cursor !== 'object') return undefined;
    cursor = Object.prototype.hasOwnProperty.call(cursor, seg)
      ? (cursor as Record<string, unknown>)[seg]
      : undefined;
  }
  return cursor;
}

export function evaluateDeclarativeValue(
  exprOrKey: unknown,
  data: unknown,
  locale: DeclarativeUiLocale = 'en',
): unknown {
  if (exprOrKey === null || exprOrKey === undefined) return undefined;
  if (typeof exprOrKey === 'string') {
    return resolveDataPath(data, exprOrKey);
  }
  if (!isDeclarativeValueExpr(exprOrKey)) {
    return exprOrKey;
  }
  const rec = exprOrKey as Record<string, unknown>;
  if (typeof rec.$path === 'string') {
    const val = resolveDataPath(data, rec.$path);
    return val !== undefined && val !== null && val !== '' ? val : rec.fallback;
  }
  if (typeof rec.$count === 'string') {
    const target = resolveDataPath(data, rec.$count);
    if (Array.isArray(target)) return target.length;
    if (target && typeof target === 'object') return Object.keys(target).length;
    return typeof target === 'number' ? target : 0;
  }
  if (rec.$sum && typeof rec.$sum === 'object') {
    const sumSpec = rec.$sum as { readonly path?: string; readonly field?: string };
    const list = sumSpec.path ? resolveDataPath(data, sumSpec.path) : undefined;
    if (!Array.isArray(list) || !sumSpec.field) return 0;
    return list.reduce((acc: number, item: unknown) => {
      let raw = resolveDataPath(item, sumSpec.field!);
      if (raw === undefined && sumSpec.field === 'pendingCount') {
        raw = resolveDataPath(item, 'drafts.length');
      }
      const n = Number(raw);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }
  const formatArgs = Array.isArray(rec.args)
    ? rec.args
    : Array.isArray(rec.$args)
      ? rec.$args
      : undefined;
  if (rec.$format !== undefined && formatArgs) {
    const template = resolveDeclarativeText(rec.$format as DeclarativeI18nText, locale);
    const args = (formatArgs as readonly string[]).map((p) => resolveDataPath(data, p));
    if (args.length > 0 && args.every((v) => v === undefined || v === null || v === '')) {
      return undefined;
    }
    return template.replace(/\{(\d+)\}/gu, (_m, idx) => {
      const v = args[Number(idx)];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  if (rec.$map && typeof rec.$map === 'object') {
    const mapSpec = rec.$map as {
      readonly path?: string;
      readonly cases?: Readonly<Record<string, DeclarativeI18nText>>;
      readonly default?: DeclarativeI18nText;
    };
    const rawVal = mapSpec.path ? resolveDataPath(data, mapSpec.path) : undefined;
    if (rawVal !== undefined && rawVal !== null && mapSpec.cases) {
      const key = String(rawVal);
      if (Object.prototype.hasOwnProperty.call(mapSpec.cases, key)) {
        return resolveDeclarativeText(mapSpec.cases[key]!, locale);
      }
    }
    if (mapSpec.default !== undefined) return resolveDeclarativeText(mapSpec.default, locale);
    return rawVal;
  }
  if (rec.$join && typeof rec.$join === 'object') {
    const joinSpec = rec.$join as {
      readonly path?: string;
      readonly sep?: string;
      readonly empty?: DeclarativeI18nText;
    };
    const list = joinSpec.path ? resolveDataPath(data, joinSpec.path) : undefined;
    if (!Array.isArray(list) || list.length === 0) {
      return joinSpec.empty !== undefined ? resolveDeclarativeText(joinSpec.empty, locale) : '—';
    }
    return list.map((item) => String(item ?? '')).join(joinSpec.sep ?? ', ');
  }
  if (Array.isArray(rec.$coalesce)) {
    for (const candidate of rec.$coalesce as readonly string[]) {
      const val = resolveDataPath(data, candidate);
      if (val !== undefined && val !== null && val !== '') return val;
    }
    return rec.fallback;
  }
  return undefined;
}

export interface DeclarativePageContext<TData = Record<string, unknown>> {
  readonly pluginId: string;
  readonly locale: DeclarativeUiLocale;
  readonly t: (key: string, ...values: readonly (string | number)[]) => string;
  readonly resource: {
    readonly state: 'loading' | 'ready' | 'empty' | 'error' | 'stale';
    readonly data: TData | undefined;
    readonly error: Error | undefined;
    readonly lastSuccessAt: number | undefined;
    readonly refreshing: boolean;
    readonly refresh: () => Promise<boolean>;
    readonly mutate: (updater: TData | ((previous: TData | undefined) => TData | undefined)) => void;
  };
  readonly call: <TResult = unknown>(
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Promise<TResult>;
  readonly refresh: () => Promise<boolean>;
  readonly notify: (tone: 'info' | 'success' | 'warning' | 'danger', message: string) => void;
}

export interface DeclarativeBadgeSpec<TData = Record<string, unknown>> {
  readonly key?: string;
  readonly label:
    | DeclarativeI18nText
    | DeclarativeValueExpr
    | ((data: TData, ctx: DeclarativePageContext<TData>) => DeclarativeRenderable);
  readonly tone?:
    | DeclarativeBadgeTone
    | DeclarativeValueExpr
    | ((data: TData) => DeclarativeBadgeTone);
}

export interface DeclarativeStatSpec<TData = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly value:
    | (keyof TData & string)
    | string
    | DeclarativeValueExpr
    | ((data: TData, ctx: DeclarativePageContext<TData>) => DeclarativeRenderable);
  readonly hint?:
    | DeclarativeI18nText
    | DeclarativeValueExpr
    | ((data: TData) => DeclarativeRenderable);
  readonly badge?: {
    readonly label:
      | DeclarativeI18nText
      | DeclarativeValueExpr
      | ((data: TData) => DeclarativeRenderable);
    readonly tone?:
      | DeclarativeBadgeTone
      | DeclarativeValueExpr
      | ((data: TData) => DeclarativeBadgeTone);
  };
}

export interface DeclarativeActionFieldSpec {
  readonly key: string;
  readonly label: DeclarativeI18nText;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
  readonly secret?: boolean;
}

export interface DeclarativeActionSpec<TData = Record<string, unknown>> {
  /** RPC action method name (`plugin.<pluginId>.<name>`). */
  readonly name: string;
  readonly label: DeclarativeI18nText;
  readonly description?: DeclarativeI18nText;
  readonly variant?: DeclarativeButtonVariant;
  readonly confirm?: DeclarativeI18nText;
  readonly confirmLabel?: DeclarativeI18nText;
  readonly fields?: readonly DeclarativeActionFieldSpec[];
  readonly params?:
    | Readonly<Record<string, unknown>>
    | ((
        data: TData | undefined,
        values: Readonly<Record<string, string>>,
      ) => Readonly<Record<string, unknown>>);
  readonly disabled?: boolean | ((data: TData | undefined) => boolean);
  readonly successMessage?: DeclarativeI18nText;
}

export interface DeclarativeColumnSpec<
  TRow = Record<string, unknown>,
  TData = Record<string, unknown>,
> {
  readonly key: keyof TRow & string;
  readonly label: DeclarativeI18nText;
  readonly render?: (
    value: unknown,
    row: TRow,
    ctx: DeclarativePageContext<TData>,
  ) => DeclarativeRenderable;
}

export interface DeclarativeSectionSpec<
  TData = Record<string, unknown>,
  TRow = Record<string, unknown>,
> {
  readonly id?: string;
  readonly title?: DeclarativeI18nText;
  readonly description?: DeclarativeI18nText;
  readonly emptyText?: DeclarativeI18nText;
  /** Extract rows for a declarative table or list. */
  readonly items?: (keyof TData & string) | ((data: TData) => readonly TRow[]);
  /** Columns for a declarative table/card list when `items` is provided. */
  readonly columns?: readonly DeclarativeColumnSpec<TRow, TData>[];
  /** Custom row renderer when `items` is provided. */
  readonly renderItem?: (
    item: TRow,
    index: number,
    ctx: DeclarativePageContext<TData>,
  ) => DeclarativeRenderable;
  /** Key-value description list extractor (`<dl className="zk-dl">`). */
  readonly entries?:
    | readonly {
        readonly label: DeclarativeI18nText;
        readonly value?: DeclarativeRenderable | DeclarativeValueExpr;
        readonly dataKey?: string;
      }[]
    | ((
        data: TData,
        ctx: DeclarativePageContext<TData>,
      ) =>
        | Readonly<Record<string, DeclarativeRenderable>>
        | readonly { readonly label: DeclarativeRenderable; readonly value: DeclarativeRenderable }[]);
  /** Custom section body renderer. */
  readonly render?: (data: TData, ctx: DeclarativePageContext<TData>) => DeclarativeRenderable;
}

export interface DeclarativePageSpec<TData = Record<string, unknown>> {
  /** Explicit plugin ID (`root/<name>`); auto-resolved from page props or route when omitted. */
  readonly pluginId?: string;
  readonly title: DeclarativeI18nText;
  readonly description?: DeclarativeI18nText;
  readonly mark?: DeclarativeRenderable;
  /** Status RPC method name; defaults to `'status'`. */
  readonly statusMethod?: string;
  /** Optional polling interval in ms; defaults to 10_000. Pass `0` to disable polling. */
  readonly pollMs?: number;
  readonly dictionary?: Readonly<Record<string, string>>;
  readonly isEmpty?: (data: TData) => boolean;
  readonly emptyTitle?: DeclarativeI18nText;
  readonly emptyDescription?: DeclarativeI18nText;
  readonly badges?:
    | readonly DeclarativeBadgeSpec<TData>[]
    | ((
        data: TData,
        ctx: DeclarativePageContext<TData>,
      ) => readonly DeclarativeBadgeSpec<TData>[]);
  readonly stats?:
    | readonly DeclarativeStatSpec<TData>[]
    | ((
        data: TData,
        ctx: DeclarativePageContext<TData>,
      ) => readonly DeclarativeStatSpec<TData>[]);
  readonly actions?: readonly DeclarativeActionSpec<TData>[];
  readonly sections?: readonly DeclarativeSectionSpec<TData, any>[];
  readonly render?: (data: TData, ctx: DeclarativePageContext<TData>) => DeclarativeRenderable;
  readonly footnote?: DeclarativeI18nText;
}

export interface DeclarativePageComponentProps {
  readonly pluginId?: string;
  readonly owner?: string;
  readonly localName?: string;
  readonly route?: string;
  readonly title?: string;
  readonly [key: string]: unknown;
}

export type ConsolePageBlueprintSection =
  | {
      readonly type: 'stats';
      readonly id: string;
      readonly title: string;
      readonly items: readonly {
        readonly key: string;
        readonly label: string;
        readonly value?: unknown;
        readonly suffix?: string;
        readonly dataKey?: string;
        readonly expr?: DeclarativeValueExpr;
      }[];
    }
  | {
      readonly type: 'table';
      readonly id: string;
      readonly title: string;
      readonly dataKey?: string;
      readonly rowKey: string;
      readonly columns: readonly { readonly key: string; readonly label: string }[];
    }
  | {
      readonly type: 'entries';
      readonly id: string;
      readonly title: string;
      readonly entries?: readonly {
        readonly label: string;
        readonly value: string;
        readonly dataKey?: string;
        readonly expr?: DeclarativeValueExpr;
      }[];
    }
  | {
      readonly type: 'actions';
      readonly id: string;
      readonly title: string;
      readonly items: readonly {
        readonly label: string;
        readonly action: string;
        readonly name?: string;
        readonly description?: string;
        readonly variant?: DeclarativeButtonVariant;
        readonly confirm?: DeclarativeI18nText;
        readonly confirmLabel?: DeclarativeI18nText;
        readonly fields?: readonly DeclarativeActionFieldSpec[];
        readonly params?: DeclarativeActionSpec<any>['params'];
        readonly disabled?: DeclarativeActionSpec<any>['disabled'];
        readonly successMessage?: DeclarativeI18nText;
      }[];
    }
  | {
      readonly type: 'markdown';
      readonly id: string;
      readonly title?: string;
      readonly content: string;
    }
  | {
      readonly type: 'custom';
      readonly id: string;
      readonly title?: string;
    };

export interface ConsolePageBlueprint<TData = Record<string, unknown>> {
  readonly kind: 'zhin.console.page-blueprint';
  readonly version: 1;
  readonly title: string;
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly description?: string;
  readonly dataSource: {
    readonly action: string;
  };
  readonly sections: readonly ConsolePageBlueprintSection[];
  readonly spec?: DeclarativePageSpec<TData>;
  readonly reviewSpec?: CommentReviewBlueprintSpec<any, any>;
}

export interface CommentReviewDraftBase {
  readonly id: string;
  readonly url: string;
  readonly message: string;
  readonly status: 'pending' | 'sending';
  readonly interrupted: boolean;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly author?: string;
  readonly original?: string;
}

export interface CommentReviewEndpointBase<D extends CommentReviewDraftBase = CommentReviewDraftBase> {
  readonly id: string;
  readonly sendMode: 'review' | 'off';
  readonly persistent: boolean;
  readonly circuit: { readonly code: number } | null;
  readonly login: { readonly state: 'none' | 'ok' | 'expired' };
  readonly pendingCount: number;
  readonly drafts: readonly D[];
}

export interface CommentReviewBlueprintSpec<
  E extends CommentReviewEndpointBase<any> = CommentReviewEndpointBase<CommentReviewDraftBase>,
  D extends CommentReviewDraftBase = CommentReviewDraftBase,
> {
  readonly adapter: string;
  readonly platform: { readonly zh: string; readonly en: string };
  readonly mark: string;
  readonly resource: { readonly zh: string; readonly en: string };
  readonly dictionary?: Readonly<Record<string, string>>;
  readonly openLabel?: string;
  readonly account?: (endpoint: E) => { readonly id?: string; readonly name?: string };
  readonly draftResource?: (
    draft: D,
    t: (key: string, ...values: readonly (string | number)[]) => string,
  ) => string;
  readonly loginHint?: (
    endpoint: E,
    t: (key: string, ...values: readonly (string | number)[]) => string,
  ) => string | undefined;
  readonly isLoginPending?: (endpoint: E) => boolean;
  readonly loginMode?: 'qr' | 'cookie-check';
  readonly resourcesKey?: string;
  readonly pollMs?: number;
  readonly pendingPollMs?: number;
}

export interface ConsoleAdapterPageBlueprint {
  readonly kind: 'zhin.console.adapter-page';
  readonly version: 1;
  readonly adapterKey: string;
  readonly dataSource: {
    readonly action: 'status';
  };
}

export type BlueprintPageComponent<TData = Record<string, unknown>> = ((
  props?: DeclarativePageComponentProps,
) => ConsolePageBlueprint<TData>) &
  Readonly<ConsolePageBlueprint<TData>>;

export type AdapterPageComponent = ((
  props?: DeclarativePageComponentProps,
) => ConsoleAdapterPageBlueprint) &
  Readonly<ConsoleAdapterPageBlueprint>;

export function resolveDeclarativeText(
  text: DeclarativeI18nText | undefined,
  preferredLocale: 'en' | 'zh-CN' = 'en',
): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (preferredLocale === 'en') {
    return text.en ?? text['zh-CN'] ?? text.zh;
  }
  return text['zh-CN'] ?? text.zh ?? text.en ?? '';
}

export function buildBlueprintFromSpec<TData = Record<string, unknown>>(
  input: DeclarativePageSpec<TData> | ConsolePageBlueprint<TData>,
): Readonly<ConsolePageBlueprint<TData>> {
  if ((input as ConsolePageBlueprint<TData>)?.kind === 'zhin.console.page-blueprint') {
    const bp = input as ConsolePageBlueprint<TData>;
    return Object.freeze({
      kind: 'zhin.console.page-blueprint' as const,
      version: 1 as const,
      title: bp.title,
      ...(bp.titleI18n ? { titleI18n: Object.freeze({ ...bp.titleI18n }) } : {}),
      ...(bp.description !== undefined ? { description: bp.description } : {}),
      dataSource: Object.freeze({ action: bp.dataSource?.action ?? 'status' }),
      sections: Object.freeze([...(bp.sections ?? [])]),
      ...(bp.spec !== undefined ? { spec: bp.spec } : {}),
      ...(bp.reviewSpec !== undefined ? { reviewSpec: bp.reviewSpec } : {}),
    });
  }

  const spec = input as DeclarativePageSpec<TData>;
  const title = resolveDeclarativeText(spec.title, 'en');
  const titleI18n =
    typeof spec.title === 'object' && spec.title !== null
      ? {
          'zh-CN': spec.title['zh-CN'] ?? spec.title.zh,
          ...(spec.title.en ? { en: spec.title.en } : {}),
        }
      : undefined;
  const description = spec.description ? resolveDeclarativeText(spec.description, 'en') : undefined;
  const dataSource = Object.freeze({ action: spec.statusMethod ?? 'status' });
  const sections: ConsolePageBlueprintSection[] = [];

  if (Array.isArray(spec.stats) && spec.stats.length > 0) {
    sections.push(
      Object.freeze({
        type: 'stats',
        id: 'runtime-stats',
        title: 'Runtime Stats',
        items: Object.freeze(
          spec.stats.map((stat, idx) =>
            Object.freeze({
              key: stat.key ?? (typeof stat.value === 'string' ? stat.value : `stat-${idx}`),
              label: resolveDeclarativeText(stat.label, 'en'),
              ...(typeof stat.value === 'string' ? { dataKey: stat.value } : {}),
              ...(isDeclarativeValueExpr(stat.value) ? { expr: stat.value } : {}),
            }),
          ),
        ),
      }),
    );
  }

  for (const [idx, sec] of (spec.sections ?? []).entries()) {
    const id = sec.id ?? `section-${idx}`;
    const secTitle = resolveDeclarativeText(sec.title, 'en');
    if (sec.columns !== undefined || sec.items !== undefined) {
      const preferredRowKey = sec.columns?.find(
        (c) => c.key === 'id' || c.key === 'key' || c.key === 'ownerKey',
      )?.key ?? 'id';
      sections.push(
        Object.freeze({
          type: 'table',
          id,
          title: secTitle,
          ...(typeof sec.items === 'string' ? { dataKey: sec.items } : {}),
          rowKey: preferredRowKey,
          columns: Object.freeze(
            (sec.columns ?? []).map((col) =>
              Object.freeze({
                key: col.key,
                label: resolveDeclarativeText(col.label, 'en'),
              }),
            ),
          ),
        }),
      );
    } else if (sec.entries !== undefined) {
      sections.push(
        Object.freeze({
          type: 'entries',
          id,
          title: secTitle,
          ...(Array.isArray(sec.entries)
            ? {
                entries: Object.freeze(
                  sec.entries.map((e) => {
                    const inferredDataKey =
                      e.dataKey ??
                      (isDeclarativeValueExpr(e.value) &&
                      typeof (e.value as { $path?: unknown }).$path === 'string'
                        ? (e.value as { $path: string }).$path
                        : undefined);
                    return Object.freeze({
                      label: resolveDeclarativeText(e.label, 'en'),
                      value: isDeclarativeValueExpr(e.value) ? '' : String(e.value ?? ''),
                      ...(inferredDataKey ? { dataKey: inferredDataKey } : {}),
                      ...(isDeclarativeValueExpr(e.value) ? { expr: e.value } : {}),
                    });
                  }),
                ),
              }
            : {}),
        }),
      );
    } else {
      sections.push(
        Object.freeze({
          type: 'custom',
          id,
          ...(secTitle ? { title: secTitle } : {}),
        }),
      );
    }
  }

  if (Array.isArray(spec.actions) && spec.actions.length > 0) {
    sections.push(
      Object.freeze({
        type: 'actions',
        id: 'actions',
        title: 'Actions',
        items: Object.freeze(
          spec.actions.map((act) =>
            Object.freeze({
              label: resolveDeclarativeText(act.label, 'en'),
              action: act.name,
              name: act.name,
              ...(act.description
                ? { description: resolveDeclarativeText(act.description, 'en') }
                : {}),
              ...(act.variant ? { variant: act.variant } : {}),
              ...(act.confirm !== undefined ? { confirm: act.confirm } : {}),
              ...(act.confirmLabel !== undefined ? { confirmLabel: act.confirmLabel } : {}),
              ...(act.fields !== undefined ? { fields: act.fields } : {}),
              ...(act.params !== undefined ? { params: act.params } : {}),
              ...(act.disabled !== undefined ? { disabled: act.disabled } : {}),
              ...(act.successMessage !== undefined ? { successMessage: act.successMessage } : {}),
            }),
          ),
        ),
      }),
    );
  }

  const rawReviewSpec = (spec as unknown as { readonly reviewSpec?: CommentReviewBlueprintSpec<any, any> }).reviewSpec;

  return Object.freeze({
    kind: 'zhin.console.page-blueprint',
    version: 1,
    title,
    ...(titleI18n ? { titleI18n: Object.freeze(titleI18n) } : {}),
    ...(description !== undefined ? { description } : {}),
    dataSource,
    sections: Object.freeze(sections),
    spec,
    ...(rawReviewSpec !== undefined ? { reviewSpec: rawReviewSpec } : {}),
  });
}

export function definePageBlueprint<TData = Record<string, unknown>>(
  spec: DeclarativePageSpec<TData> | ConsolePageBlueprint<TData>,
): BlueprintPageComponent<TData> {
  const blueprint = buildBlueprintFromSpec(spec);
  function BlueprintPage(_props?: DeclarativePageComponentProps): ConsolePageBlueprint<TData> {
    return blueprint;
  }
  return Object.freeze(Object.assign(BlueprintPage, blueprint));
}

export const createDeclarativePage = definePageBlueprint;

export function defineAdapterPage(adapterKey: string): AdapterPageComponent {
  const validKey = optionalString(adapterKey, 'Adapter page adapterKey');
  if (!validKey) throw new TypeError('Adapter page adapterKey must be a non-empty string');
  const blueprint: ConsoleAdapterPageBlueprint = Object.freeze({
    kind: 'zhin.console.adapter-page',
    version: 1,
    adapterKey: validKey,
    dataSource: Object.freeze({ action: 'status' as const }),
  });
  function AdapterConsoleRoute(_props?: DeclarativePageComponentProps): ConsoleAdapterPageBlueprint {
    return blueprint;
  }
  return Object.freeze(Object.assign(AdapterConsoleRoute, blueprint));
}

export const createAdapterConsolePage = defineAdapterPage;

export function defineCommentReviewPage<
  E extends CommentReviewEndpointBase<any> = CommentReviewEndpointBase<CommentReviewDraftBase>,
  D extends CommentReviewDraftBase = CommentReviewDraftBase,
>(
  reviewSpec: CommentReviewBlueprintSpec<E, D>,
): BlueprintPageComponent<{ readonly endpoints?: readonly E[]; readonly updatedAt?: number }> {
  const zhTitle = `${reviewSpec.platform.zh}评论审批`;
  const enTitle = `${reviewSpec.platform.en} comment review`;
  const loginActions: DeclarativeActionSpec<any>[] =
    reviewSpec.loginMode === 'cookie-check'
      ? [{ name: 'login-check', label: { zh: '重新检查登录', en: 'Check login again' } }]
      : [
          { name: 'login', label: { zh: '扫码登录', en: 'Sign in with QR code' }, variant: 'primary' },
          { name: 'login-cancel', label: { zh: '取消扫码', en: 'Cancel QR login' }, variant: 'ghost' },
          { name: 'logout', label: { zh: '退出登录', en: 'Sign out' }, variant: 'secondary' },
        ];
  const blueprint = buildBlueprintFromSpec<{ readonly endpoints?: readonly E[]; readonly updatedAt?: number }>({
    pluginId: reviewSpec.adapter,
    title: { zh: zhTitle, 'zh-CN': zhTitle, en: enTitle },
    mark: reviewSpec.mark,
    statusMethod: 'status',
    pollMs: reviewSpec.pollMs ?? 10_000,
    ...(reviewSpec.dictionary ? { dictionary: reviewSpec.dictionary } : {}),
    stats: [
      {
        key: 'endpoints',
        label: { zh: '账号数', en: 'Accounts' },
        value: { $count: 'endpoints' },
      },
      {
        key: 'pendingDrafts',
        label: { zh: '待审草稿', en: 'Pending drafts' },
        value: { $sum: { path: 'endpoints', field: 'pendingCount' } },
      },
    ],
    sections: [
      {
        id: 'endpoints',
        title: { zh: '评论账号与待审草稿', en: 'Accounts & Pending Drafts' },
        items: 'endpoints',
        columns: [
          { key: 'id', label: { zh: '账号', en: 'Account' } },
          { key: 'sendMode', label: { zh: '发送模式', en: 'Send Mode' } },
          { key: 'pendingCount', label: { zh: '待审数', en: 'Pending' } },
        ],
      },
    ],
    actions: [
      ...loginActions,
      {
        name: 'edit',
        label: { zh: '修改草稿', en: 'Edit draft' },
        fields: [
          { key: 'id', label: { zh: '草稿 ID', en: 'Draft ID' }, required: true },
          { key: 'message', label: { zh: '回复内容', en: 'Reply content' }, required: true },
        ],
      },
      {
        name: 'send',
        label: { zh: '发送草稿', en: 'Send draft' },
        variant: 'primary',
        fields: [{ key: 'id', label: { zh: '草稿 ID', en: 'Draft ID' }, required: true }],
      },
      {
        name: 'drop',
        label: { zh: '丢弃草稿', en: 'Discard draft' },
        variant: 'danger',
        confirm: { zh: '确认丢弃该草稿？', en: 'Discard this draft?' },
        fields: [{ key: 'id', label: { zh: '草稿 ID', en: 'Draft ID' }, required: true }],
      },
    ],
  });
  const enriched: ConsolePageBlueprint<{ readonly endpoints?: readonly E[]; readonly updatedAt?: number }> =
    Object.freeze({
      ...blueprint,
      reviewSpec,
    });
  function CommentReviewBlueprintPage(
    _props?: DeclarativePageComponentProps,
  ): ConsolePageBlueprint<{ readonly endpoints?: readonly E[]; readonly updatedAt?: number }> {
    return enriched;
  }
  return Object.freeze(Object.assign(CommentReviewBlueprintPage, enriched));
}

export const createCommentReviewPage = defineCommentReviewPage;

// ── Multi-Surface Blueprint Projection (IM Card & CLI TUI) ─────────────────

export interface BlueprintProjectionOptions {
  readonly locale?: DeclarativeUiLocale;
  readonly pluginId?: string;
  readonly maxRows?: number;
}

export interface BlueprintImStatItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly badge?: string;
}

export interface BlueprintImTableSection {
  readonly id: string;
  readonly title: string;
  readonly columns: readonly { readonly key: string; readonly label: string }[];
  readonly rows: readonly (readonly string[])[];
  readonly totalRows: number;
  readonly emptyText?: string;
}

export interface BlueprintImEntriesSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly { readonly label: string; readonly value: string }[];
}

export interface BlueprintImActionItem {
  readonly name: string;
  readonly label: string;
  readonly rpcMethod: string;
  readonly description?: string;
  readonly variant: DeclarativeButtonVariant;
  readonly disabled: boolean;
}

export interface BlueprintImSegment {
  readonly type: 'card' | 'markdown' | 'button' | 'text';
  readonly data: Readonly<Record<string, unknown>>;
}

export interface BlueprintImCardProjection {
  readonly kind: 'zhin.im.blueprint-card';
  readonly pluginId: string;
  readonly title: string;
  readonly description?: string;
  readonly stats: readonly BlueprintImStatItem[];
  readonly tables: readonly BlueprintImTableSection[];
  readonly entries: readonly BlueprintImEntriesSection[];
  readonly actions: readonly BlueprintImActionItem[];
  readonly markdown: string;
  readonly segments: readonly BlueprintImSegment[];
}

function createProjectionContext<TData = Record<string, unknown>>(
  data: TData | undefined,
  locale: DeclarativeUiLocale,
  pluginId: string,
  dictionary?: Readonly<Record<string, string>>,
): DeclarativePageContext<TData> {
  const t = (key: string, ...values: readonly (string | number)[]): string => {
    const template = locale === 'en' && dictionary?.[key] ? dictionary[key] : key;
    return template.replace(/\{(\d+)\}/gu, (_m, idx) => String(values[Number(idx)] ?? ''));
  };
  return {
    pluginId,
    locale,
    t,
    resource: {
      state: data === undefined ? 'empty' : 'ready',
      data,
      error: undefined,
      lastSuccessAt: Date.now(),
      refreshing: false,
      refresh: async () => true,
      mutate: () => undefined,
    },
    call: async () => undefined as never,
    refresh: async () => true,
    notify: () => undefined,
  };
}

function formatRenderableValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => formatRenderableValue(item)).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.label === 'string') return record.label;
    if (typeof record.text === 'string') return record.text;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Projects any Server-Driven Console Blueprint (`definePageBlueprint`, `defineAdapterPage`,
 * `defineCommentReviewPage`, or `DeclarativePageSpec`) + runtime status payload into a
 * structured IM Card / Markdown / Segment payload ready for `Message.$reply` or `Adapter.sendMessage`.
 */
export function projectBlueprintToImCard<TData = Record<string, unknown>>(
  input:
    | ConsolePageBlueprint<TData>
    | ConsoleAdapterPageBlueprint
    | DeclarativePageSpec<TData>,
  data?: TData,
  options: BlueprintProjectionOptions = {},
): Readonly<BlueprintImCardProjection> {
  const locale: DeclarativeUiLocale = options.locale ?? 'zh-CN';
  const maxRows = Math.max(1, options.maxRows ?? 10);
  const recordData = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  if ((input as ConsoleAdapterPageBlueprint)?.kind === 'zhin.console.adapter-page') {
    const adapterBp = input as ConsoleAdapterPageBlueprint;
    const pluginId = options.pluginId ?? adapterBp.adapterKey;
    const title =
      locale === 'zh-CN'
        ? `${adapterBp.adapterKey} 适配器状态`
        : `${adapterBp.adapterKey} Adapter Status`;
    const bots = Array.isArray(recordData.bots)
      ? recordData.bots
      : Array.isArray(recordData.endpoints)
        ? recordData.endpoints
        : [];
    const onlineCount = bots.filter(
      (b: any) => b?.online === true || b?.connected === true || b?.status === 'online',
    ).length;
    const stats: BlueprintImStatItem[] = [
      {
        key: 'adapter',
        label: locale === 'zh-CN' ? '适配器' : 'Adapter',
        value: adapterBp.adapterKey,
      },
      {
        key: 'endpoints',
        label: locale === 'zh-CN' ? '实例数' : 'Instances',
        value: String(bots.length),
      },
      {
        key: 'online',
        label: locale === 'zh-CN' ? '在线数' : 'Online',
        value: String(onlineCount),
      },
    ];
    const columns = [
      { key: 'id', label: locale === 'zh-CN' ? '账号/端点' : 'Endpoint' },
      { key: 'status', label: locale === 'zh-CN' ? '状态' : 'Status' },
    ];
    const rows = bots.slice(0, maxRows).map((b: any, i: number) => [
      String(b?.id ?? b?.selfId ?? b?.name ?? `#${i + 1}`),
      String(
        b?.status ??
          (b?.online === true || b?.connected === true
            ? locale === 'zh-CN'
              ? '在线'
              : 'online'
            : locale === 'zh-CN'
              ? '离线'
              : 'offline'),
      ),
    ]);
    const tables: BlueprintImTableSection[] =
      bots.length > 0
        ? [
            {
              id: 'endpoints',
              title: locale === 'zh-CN' ? '端点列表' : 'Endpoints',
              columns,
              rows,
              totalRows: bots.length,
            },
          ]
        : [];
    const mdLines = [
      `### ${title}`,
      stats.map((s) => `- **${s.label}**: ${s.value}`).join('\n'),
    ];
    if (tables.length > 0) {
      for (const tbl of tables) {
        mdLines.push(`\n#### ${tbl.title}`);
        mdLines.push(`| ${tbl.columns.map((c) => c.label).join(' | ')} |`);
        mdLines.push(`| ${tbl.columns.map(() => '---').join(' | ')} |`);
        for (const r of tbl.rows) {
          mdLines.push(`| ${r.join(' | ')} |`);
        }
      }
    }
    const markdown = mdLines.filter(Boolean).join('\n');
    const segments: BlueprintImSegment[] = [
      {
        type: 'card',
        data: {
          title,
          pluginId,
          stats,
          tables,
        },
      },
      {
        type: 'markdown',
        data: { content: markdown },
      },
    ];
    return Object.freeze({
      kind: 'zhin.im.blueprint-card',
      pluginId,
      title,
      stats: Object.freeze(stats),
      tables: Object.freeze(tables),
      entries: Object.freeze([]),
      actions: Object.freeze([]),
      markdown,
      segments: Object.freeze(segments),
    });
  }

  const bp =
    (input as ConsolePageBlueprint<TData>)?.kind === 'zhin.console.page-blueprint'
      ? (input as ConsolePageBlueprint<TData>)
      : buildBlueprintFromSpec(input as DeclarativePageSpec<TData>);
  const spec = bp.spec;
  const pluginId = options.pluginId ?? spec?.pluginId ?? 'plugin';
  const ctx = createProjectionContext(data, locale, pluginId, spec?.dictionary);
  const title =
    (locale === 'zh-CN' ? bp.titleI18n?.['zh-CN'] : bp.titleI18n?.en) ??
    (spec?.title ? resolveDeclarativeText(spec.title, locale) : bp.title);
  const description = spec?.description
    ? resolveDeclarativeText(spec.description, locale)
    : bp.description;

  const stats: BlueprintImStatItem[] = [];
  const rawStats =
    typeof spec?.stats === 'function'
      ? spec.stats((data ?? ({} as TData)), ctx)
      : Array.isArray(spec?.stats)
        ? spec.stats
        : undefined;
  if (rawStats) {
    for (const [idx, s] of rawStats.entries()) {
      const val =
        typeof s.value === 'function'
          ? s.value((data ?? ({} as TData)), ctx)
          : evaluateDeclarativeValue(s.value, recordData, locale);
      const hint =
        typeof s.hint === 'function'
          ? formatRenderableValue(s.hint((data ?? ({} as TData))))
          : isDeclarativeValueExpr(s.hint)
            ? formatRenderableValue(evaluateDeclarativeValue(s.hint, recordData, locale))
            : s.hint
              ? resolveDeclarativeText(s.hint, locale)
              : undefined;
      const badge = s.badge
        ? typeof s.badge.label === 'function'
          ? formatRenderableValue(s.badge.label((data ?? ({} as TData))))
          : isDeclarativeValueExpr(s.badge.label)
            ? formatRenderableValue(evaluateDeclarativeValue(s.badge.label, recordData, locale))
            : resolveDeclarativeText(s.badge.label, locale)
        : undefined;
      stats.push(
        Object.freeze({
          key: s.key ?? `stat-${idx}`,
          label: resolveDeclarativeText(s.label, locale),
          value: formatRenderableValue(val),
          ...(hint ? { hint } : {}),
          ...(badge ? { badge } : {}),
        }),
      );
    }
  } else {
    for (const sec of bp.sections) {
      if (sec.type === 'stats') {
        for (const item of sec.items) {
          const val = item.expr
            ? evaluateDeclarativeValue(item.expr, recordData, locale)
            : item.dataKey
              ? resolveDataPath(recordData, item.dataKey)
              : item.value;
          stats.push(
            Object.freeze({
              key: item.key,
              label: item.label,
              value: `${formatRenderableValue(val)}${item.suffix ?? ''}`,
            }),
          );
        }
      }
    }
  }

  const tables: BlueprintImTableSection[] = [];
  const entries: BlueprintImEntriesSection[] = [];

  if (Array.isArray(spec?.sections)) {
    for (const [idx, sec] of spec.sections.entries()) {
      const id = sec.id ?? `section-${idx}`;
      const secTitle = resolveDeclarativeText(sec.title, locale) || id;
      if (sec.items !== undefined) {
        const rawItems =
          typeof sec.items === 'function'
            ? sec.items((data ?? ({} as TData)))
            : (resolveDataPath(recordData, sec.items) as readonly Record<string, unknown>[] | undefined);
        const list = Array.isArray(rawItems) ? rawItems : [];
        const cols: readonly {
          readonly key: string;
          readonly label: string;
          readonly render?: (
            value: unknown,
            row: unknown,
            ctx: DeclarativePageContext<TData>,
          ) => DeclarativeRenderable;
        }[] =
          sec.columns && sec.columns.length > 0
            ? sec.columns.map((c: DeclarativeColumnSpec<any, TData>) => ({
                key: c.key,
                label: resolveDeclarativeText(c.label, locale),
                render: c.render,
              }))
            : list[0] && typeof list[0] === 'object'
              ? Object.keys(list[0] as Record<string, unknown>)
                  .slice(0, 5)
                  .map((k) => ({ key: k, label: k, render: undefined }))
              : [{ key: 'value', label: locale === 'zh-CN' ? '内容' : 'Value', render: undefined }];
        const rows = list.slice(0, maxRows).map((row, rowIdx) => {
          if (sec.renderItem && (!sec.columns || sec.columns.length === 0)) {
            return [formatRenderableValue(sec.renderItem(row, rowIdx, ctx))];
          }
          const rec = (row && typeof row === 'object' ? row : { value: row }) as Record<string, unknown>;
          return cols.map((c) => {
            const cellVal = resolveDataPath(rec, c.key);
            return c.render
              ? formatRenderableValue(c.render(cellVal, row, ctx))
              : formatRenderableValue(cellVal);
          });
        });
        const emptyText = sec.emptyText ? resolveDeclarativeText(sec.emptyText, locale) : undefined;
        tables.push(
          Object.freeze({
            id,
            title: secTitle,
            columns: Object.freeze(cols.map(({ key, label }) => Object.freeze({ key, label }))),
            rows: Object.freeze(rows.map((r) => Object.freeze(r))),
            totalRows: list.length,
            ...(emptyText ? { emptyText } : {}),
          }),
        );
      } else if (sec.entries !== undefined) {
        const rawEntries =
          typeof sec.entries === 'function'
            ? sec.entries((data ?? ({} as TData)), ctx)
            : sec.entries;
        const items = Array.isArray(rawEntries)
          ? rawEntries.map((entry) => {
              const entryRecord = entry as {
                readonly label: unknown;
                readonly value: unknown;
                readonly dataKey?: string;
                readonly expr?: DeclarativeValueExpr;
              };
              const resolvedValue = isDeclarativeValueExpr(entryRecord.expr)
                ? evaluateDeclarativeValue(entryRecord.expr, recordData, locale)
                : isDeclarativeValueExpr(entryRecord.value)
                  ? evaluateDeclarativeValue(entryRecord.value, recordData, locale)
                  : entryRecord.dataKey
                    ? resolveDataPath(recordData, entryRecord.dataKey)
                    : entryRecord.value;
              return Object.freeze({
                label:
                  typeof entryRecord.label === 'object' &&
                  entryRecord.label !== null &&
                  ('zh' in entryRecord.label || 'en' in entryRecord.label || 'zh-CN' in entryRecord.label)
                    ? resolveDeclarativeText(entryRecord.label as DeclarativeI18nText, locale)
                    : formatRenderableValue(entryRecord.label),
                value: formatRenderableValue(resolvedValue),
              });
            })
          : Object.entries(rawEntries ?? {}).map(([k, v]) =>
              Object.freeze({
                label: k,
                value: formatRenderableValue(
                  isDeclarativeValueExpr(v) ? evaluateDeclarativeValue(v, recordData, locale) : v,
                ),
              }),
            );
        entries.push(
          Object.freeze({
            id,
            title: secTitle,
            items: Object.freeze(items),
          }),
        );
      }
    }
  } else {
    for (const sec of bp.sections) {
      if (sec.type === 'table') {
        const rawItems = sec.dataKey ? resolveDataPath(recordData, sec.dataKey) : undefined;
        const list = Array.isArray(rawItems) ? rawItems : [];
        const rows = list.slice(0, maxRows).map((row) => {
          const rec = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
          return sec.columns.map((c) => formatRenderableValue(resolveDataPath(rec, c.key)));
        });
        tables.push(
          Object.freeze({
            id: sec.id,
            title: sec.title,
            columns: sec.columns,
            rows: Object.freeze(rows.map((r) => Object.freeze(r))),
            totalRows: list.length,
          }),
        );
      } else if (sec.type === 'entries' && Array.isArray(sec.entries)) {
        entries.push(
          Object.freeze({
            id: sec.id,
            title: sec.title,
            items: Object.freeze(
              sec.entries.map((entry) => {
                const resolvedValue = entry.expr
                  ? evaluateDeclarativeValue(entry.expr, recordData, locale)
                  : isDeclarativeValueExpr(entry.value)
                    ? evaluateDeclarativeValue(entry.value, recordData, locale)
                    : entry.dataKey
                      ? resolveDataPath(recordData, entry.dataKey)
                      : entry.value;
                return Object.freeze({
                  label: formatRenderableValue(entry.label),
                  value: formatRenderableValue(resolvedValue),
                });
              }),
            ),
          }),
        );
      }
    }
  }

  const actions: BlueprintImActionItem[] = [];
  if (Array.isArray(spec?.actions)) {
    for (const act of spec.actions) {
      const disabled =
        typeof act.disabled === 'function' ? act.disabled(data) : Boolean(act.disabled);
      const desc = act.description ? resolveDeclarativeText(act.description, locale) : undefined;
      actions.push(
        Object.freeze({
          name: act.name,
          label: resolveDeclarativeText(act.label, locale),
          rpcMethod: `plugin.${pluginId}.${act.name}`,
          ...(desc ? { description: desc } : {}),
          variant: act.variant ?? 'secondary',
          disabled,
        }),
      );
    }
  } else {
    for (const sec of bp.sections) {
      if (sec.type === 'actions') {
        for (const item of sec.items) {
          actions.push(
            Object.freeze({
              name: item.name ?? item.action,
              label: item.label,
              rpcMethod: `plugin.${pluginId}.${item.action}`,
              ...(item.description ? { description: item.description } : {}),
              variant: item.variant ?? 'secondary',
              disabled: false,
            }),
          );
        }
      }
    }
  }

  const mdLines: string[] = [`### ${title}`];
  if (description) mdLines.push(description);
  if (stats.length > 0) {
    mdLines.push('');
    for (const s of stats) {
      const badgeSuffix = s.badge ? ` [${s.badge}]` : '';
      const hintSuffix = s.hint ? ` (${s.hint})` : '';
      mdLines.push(`- **${s.label}**: ${s.value}${badgeSuffix}${hintSuffix}`);
    }
  }
  for (const entrySec of entries) {
    mdLines.push(`\n#### ${entrySec.title}`);
    for (const item of entrySec.items) {
      mdLines.push(`- **${item.label}**: ${item.value}`);
    }
  }
  for (const tbl of tables) {
    mdLines.push(`\n#### ${tbl.title} (${tbl.totalRows})`);
    if (tbl.rows.length === 0) {
      mdLines.push(`_${tbl.emptyText ?? (locale === 'zh-CN' ? '暂无数据' : 'No data')}_`);
    } else {
      mdLines.push(`| ${tbl.columns.map((c) => c.label).join(' | ')} |`);
      mdLines.push(`| ${tbl.columns.map(() => '---').join(' | ')} |`);
      for (const r of tbl.rows) {
        mdLines.push(`| ${r.join(' | ')} |`);
      }
    }
  }
  if (actions.length > 0) {
    mdLines.push(
      `\n> ${locale === 'zh-CN' ? '可执行操作' : 'Available Actions'}: ${actions
        .map((a) => `\`${a.label}\` (${a.name})`)
        .join(' · ')}`,
    );
  }
  const markdown = mdLines.join('\n');

  const segments: BlueprintImSegment[] = [
    {
      type: 'card',
      data: {
        title,
        ...(description ? { description } : {}),
        pluginId,
        stats,
        tables,
        entries,
        actions,
      },
    },
    {
      type: 'markdown',
      data: { content: markdown },
    },
    ...actions
      .filter((a) => !a.disabled)
      .map(
        (a): BlueprintImSegment => ({
          type: 'button',
          data: {
            id: a.rpcMethod,
            label: a.label,
            action: a.name,
            variant: a.variant,
          },
        }),
      ),
  ];

  return Object.freeze({
    kind: 'zhin.im.blueprint-card',
    pluginId,
    title,
    ...(description ? { description } : {}),
    stats: Object.freeze(stats),
    tables: Object.freeze(tables),
    entries: Object.freeze(entries),
    actions: Object.freeze(actions),
    markdown,
    segments: Object.freeze(segments),
  });
}

export interface BlueprintCliPanelOptions extends BlueprintProjectionOptions {
  readonly width?: number;
}

/**
 * Projects any Server-Driven Console Blueprint (`definePageBlueprint`, `defineAdapterPage`,
 * `defineCommentReviewPage`, or `DeclarativePageSpec`) + runtime status payload into a
 * formatted CLI TUI panel string.
 */
export function projectBlueprintToCliPanel<TData = Record<string, unknown>>(
  input:
    | ConsolePageBlueprint<TData>
    | ConsoleAdapterPageBlueprint
    | DeclarativePageSpec<TData>,
  data?: TData,
  options: BlueprintCliPanelOptions = {},
): string {
  const card = projectBlueprintToImCard(input, data, options);
  const width = Math.max(44, options.width ?? 72);
  const innerWidth = width - 4;
  const hr = '─'.repeat(width - 2);
  const padLine = (text: string): string => {
    const clean = text.replace(/\r?\n/gu, ' ').slice(0, innerWidth);
    const pad = Math.max(0, innerWidth - clean.length);
    return `│ ${clean}${' '.repeat(pad)} │`;
  };

  const lines: string[] = [`┌${hr}┐`, padLine(`[${card.pluginId}] ${card.title}`)];
  if (card.description) {
    lines.push(padLine(card.description));
  }
  lines.push(`├${hr}┤`);

  if (card.stats.length > 0) {
    const statSummary = card.stats
      .map((s) => `${s.label}: ${s.value}${s.badge ? ` [${s.badge}]` : ''}`)
      .join('  │  ');
    lines.push(padLine(statSummary));
    lines.push(`├${hr}┤`);
  }

  for (const entrySec of card.entries) {
    lines.push(padLine(`■ ${entrySec.title}`));
    for (const item of entrySec.items) {
      lines.push(padLine(`  ${item.label}: ${item.value}`));
    }
    lines.push(`├${hr}┤`);
  }

  for (const tbl of card.tables) {
    lines.push(padLine(`■ ${tbl.title} (${tbl.totalRows})`));
    if (tbl.rows.length === 0) {
      lines.push(padLine(`  (${tbl.emptyText ?? 'empty'})`));
    } else {
      lines.push(padLine(`  ${tbl.columns.map((c) => c.label).join(' | ')}`));
      for (const row of tbl.rows) {
        lines.push(padLine(`  ${row.join(' | ')}`));
      }
    }
    lines.push(`├${hr}┤`);
  }

  if (card.actions.length > 0) {
    const actionBar = card.actions
      .map((a) => (a.disabled ? `(${a.label})` : `[${a.label} -> ${a.name}]`))
      .join(' ');
    lines.push(padLine(`Actions: ${actionBar}`));
  } else {
    // Remove trailing separator if no actions
    if (lines[lines.length - 1] === `├${hr}┤`) {
      lines.pop();
    }
  }

  lines.push(`└${hr}┘`);
  return lines.join('\n');
}
