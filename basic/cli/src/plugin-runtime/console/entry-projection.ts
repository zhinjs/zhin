import {
  extractBearerToken,
  publicConsoleAccess,
  type ConsoleAccess,
  type HttpHost,
  type RuntimeConsolePage,
} from '@zhin.js/host-http';
import type { IncomingMessage } from 'node:http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';

export type ConsolePageTitleI18n = Readonly<Partial<Record<'zh-CN' | 'en' | string, string>>>;

export type ExtendedRuntimeConsolePage = RuntimeConsolePage & {
  readonly owner?: string;
  readonly source?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly group?: string;
  readonly parent?: string | null;
  readonly fullWidth?: boolean;
  readonly hideInNav?: boolean;
  readonly titleI18n?: ConsolePageTitleI18n;
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
};

export interface ProjectConsoleEntriesOptions {
  readonly locale?: string;
  readonly runtimeEnvHint?: 'development' | 'production';
}

/**
 * Console access of one HTTP request, from its bearer token (header, or `?token=` for page
 * navigations). Routes outside the API base are public, so a missing token means public access.
 */
export function requestConsoleAccess(http: HttpHost, request: IncomingMessage, url?: URL): ConsoleAccess {
  const header = request.headers?.authorization;
  const token = extractBearerToken(Array.isArray(header) ? header[0] : header, url?.searchParams.get('token') ?? null);
  return http.tokenRegistry.resolveAccess(token);
}

export function resolveLocalizedPageTitle(
  title: string,
  titleI18n?: ConsolePageTitleI18n,
  locale?: string,
): string {
  if (!locale || !titleI18n || typeof titleI18n !== 'object') return title;
  const map = titleI18n as Record<string, unknown>;
  const direct = map[locale];
  if (typeof direct === 'string' && direct.trim()) return direct;
  const normalized = locale.toLowerCase();
  const langPrefix = normalized.split('-')[0] ?? normalized;
  if (langPrefix === 'zh') {
    const zh = map['zh-CN'] ?? map.zh;
    if (typeof zh === 'string' && zh.trim()) return zh;
  } else if (langPrefix === 'en') {
    const en = map.en ?? map['en-US'];
    if (typeof en === 'string' && en.trim()) return en;
  }
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase().startsWith(langPrefix) && typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return title;
}

/** Pages the caller may open. Defaults to public access, never to the operator's view. */
export async function listPages(
  consoleRuntime: ConsoleRuntime,
  access: ConsoleAccess = publicConsoleAccess,
  options?: { readonly locale?: string },
): Promise<readonly ExtendedRuntimeConsolePage[]> {
  const pages = await consoleRuntime.runView(access, (catalog) => catalog.pages());
  return Object.freeze(pages.map((rawPage) => {
    const page = rawPage as ExtendedRuntimeConsolePage;
    const title = resolveLocalizedPageTitle(page.title, page.titleI18n, options?.locale);
    return Object.freeze({
      id: page.id,
      localName: page.localName,
      title,
      route: page.route,
      module: page.module,
      order: page.order,
      hash: page.hash,
      ...(page.owner !== undefined ? { owner: page.owner } : {}),
      ...(page.source !== undefined ? { source: page.source } : {}),
      ...(page.description !== undefined ? { description: page.description } : {}),
      ...(page.icon !== undefined ? { icon: page.icon } : {}),
      ...(page.group !== undefined ? { group: page.group } : {}),
      ...(page.parent !== undefined ? { parent: page.parent } : {}),
      ...(page.fullWidth !== undefined ? { fullWidth: page.fullWidth } : {}),
      ...(page.hideInNav !== undefined ? { hideInNav: page.hideInNav } : {}),
      ...(page.titleI18n !== undefined ? { titleI18n: page.titleI18n } : {}),
      ...(page.requiredPermissions !== undefined ? { requiredPermissions: page.requiredPermissions } : {}),
      ...(page.requiredRoles !== undefined ? { requiredRoles: page.requiredRoles } : {}),
    });
  }));
}

/** Console shell entry shape consumed by `@zhin.js/contract` clients. */
export type ConsoleEntryBody = {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly module: string;
  readonly resolvedModule: string;
  readonly order: number;
  readonly enabled: boolean;
  readonly meta: {
    readonly name: string;
    readonly description?: string;
    readonly icon?: string;
    readonly group?: string;
    readonly order?: number;
    readonly parent?: string | null;
    readonly fullWidth?: boolean;
    readonly hideInMenu?: boolean;
    readonly hideInNav?: boolean;
    readonly titleI18n?: ConsolePageTitleI18n;
  };
  readonly route: string;
  readonly hash: string;
  readonly owner?: string;
  readonly source?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly group?: string;
  readonly parent?: string | null;
  readonly fullWidth?: boolean;
  readonly hideInNav?: boolean;
  readonly titleI18n?: ConsolePageTitleI18n;
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
};

export type ConsoleEntriesBody = {
  readonly entries: readonly ConsoleEntryBody[];
  readonly runtimeEnvHint: 'development' | 'production';
};

/**
 * Projects a Console catalog or page list into the Console entry discovery response,
 * forwarding all PageMetadata fields and resolving localized titles when `options.locale` is set.
 */
export function projectConsoleEntries(
  catalogOrPages:
    | readonly ExtendedRuntimeConsolePage[]
    | { readonly pages: () => readonly ExtendedRuntimeConsolePage[] },
  options: ProjectConsoleEntriesOptions = {},
): ConsoleEntriesBody {
  const pages = Array.isArray(catalogOrPages)
    ? catalogOrPages
    : (catalogOrPages as { readonly pages: () => readonly ExtendedRuntimeConsolePage[] }).pages();
  const runtimeEnvHint = options.runtimeEnvHint ?? defaultRuntimeEnvHint();
  const entries = [...pages]
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    .map((page) => {
      const title = resolveLocalizedPageTitle(page.title, page.titleI18n, options.locale);
      return Object.freeze({
        id: page.localName,
        name: page.localName,
        title,
        module: page.module,
        resolvedModule: page.module,
        order: page.order,
        enabled: true,
        meta: Object.freeze({
          name: title,
          ...(page.description !== undefined ? { description: page.description } : {}),
          ...(page.icon !== undefined ? { icon: page.icon } : {}),
          ...(page.group !== undefined ? { group: page.group } : {}),
          ...(page.order !== undefined ? { order: page.order } : {}),
          ...(page.parent !== undefined ? { parent: page.parent } : {}),
          ...(page.fullWidth !== undefined ? { fullWidth: page.fullWidth } : {}),
          ...(page.hideInNav !== undefined ? { hideInMenu: page.hideInNav, hideInNav: page.hideInNav } : {}),
          ...(page.titleI18n !== undefined ? { titleI18n: page.titleI18n } : {}),
        }),
        route: page.route,
        hash: page.hash,
        ...(page.owner !== undefined ? { owner: page.owner } : {}),
        ...(page.source !== undefined ? { source: page.source } : {}),
        ...(page.description !== undefined ? { description: page.description } : {}),
        ...(page.icon !== undefined ? { icon: page.icon } : {}),
        ...(page.group !== undefined ? { group: page.group } : {}),
        ...(page.parent !== undefined ? { parent: page.parent } : {}),
        ...(page.fullWidth !== undefined ? { fullWidth: page.fullWidth } : {}),
        ...(page.hideInNav !== undefined ? { hideInNav: page.hideInNav } : {}),
        ...(page.titleI18n !== undefined ? { titleI18n: page.titleI18n } : {}),
        ...(page.requiredPermissions !== undefined ? { requiredPermissions: page.requiredPermissions } : {}),
        ...(page.requiredRoles !== undefined ? { requiredRoles: page.requiredRoles } : {}),
      });
    });
  return Object.freeze({ entries: Object.freeze(entries), runtimeEnvHint });
}

/** Maps the current page catalog to the Console entry discovery response. */
export function buildConsoleEntriesBody(
  pages: readonly ExtendedRuntimeConsolePage[],
  runtimeEnvHint: 'development' | 'production' = defaultRuntimeEnvHint(),
  options?: { readonly locale?: string },
): ConsoleEntriesBody {
  return projectConsoleEntries(pages, {
    runtimeEnvHint,
    ...(options?.locale !== undefined ? { locale: options.locale } : {}),
  });
}

function defaultRuntimeEnvHint(): 'development' | 'production' {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
    ? 'production'
    : 'development';
}
