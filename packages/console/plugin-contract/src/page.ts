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
}

export function normalizeClientModuleArtifact(
  value: unknown,
  label: string,
): Readonly<ClientModuleArtifact> {
  const input = requireRecord(value, label);
  const module = optionalString(input.module, `${label} module`);
  const hash = optionalString(input.hash, `${label} hash`);
  if (!module || !hash) throw new TypeError(`${label} must include module and hash`);
  return Object.freeze({ module, hash, metadata: input.metadata });
}

export interface PageManifest extends NormalizedPageMetadata {
  readonly id: string;
  readonly owner: string;
  readonly localName: string;
  readonly source: string;
  readonly module: string;
  readonly hash: string;
  readonly route: string;
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
    | ((data: TData, ctx: DeclarativePageContext<TData>) => DeclarativeRenderable);
  readonly tone?: DeclarativeBadgeTone | ((data: TData) => DeclarativeBadgeTone);
}

export interface DeclarativeStatSpec<TData = Record<string, unknown>> {
  readonly key?: string;
  readonly label: DeclarativeI18nText;
  readonly value:
    | (keyof TData & string)
    | ((data: TData, ctx: DeclarativePageContext<TData>) => DeclarativeRenderable);
  readonly hint?: DeclarativeI18nText | ((data: TData) => DeclarativeRenderable);
  readonly badge?: {
    readonly label: DeclarativeI18nText | ((data: TData) => DeclarativeRenderable);
    readonly tone?: DeclarativeBadgeTone | ((data: TData) => DeclarativeBadgeTone);
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
  readonly entries?: (
    data: TData,
    ctx: DeclarativePageContext<TData>,
  ) =>
    | Readonly<Record<string, DeclarativeRenderable>>
    | readonly { readonly label: DeclarativeRenderable; readonly value: DeclarativeRenderable }[];
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
      sections.push(
        Object.freeze({
          type: 'table',
          id,
          title: secTitle,
          ...(typeof sec.items === 'string' ? { dataKey: sec.items } : {}),
          rowKey: sec.columns?.[0]?.key ?? 'id',
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
            }),
          ),
        ),
      }),
    );
  }

  return Object.freeze({
    kind: 'zhin.console.page-blueprint',
    version: 1,
    title,
    ...(titleI18n ? { titleI18n: Object.freeze(titleI18n) } : {}),
    ...(description !== undefined ? { description } : {}),
    dataSource,
    sections: Object.freeze(sections),
    spec,
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
