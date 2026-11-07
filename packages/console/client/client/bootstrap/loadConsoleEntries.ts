import { DEFAULT_CONSOLE_BASE_PATH, type ConsoleClientEntry, type ConsoleEntriesResponse, type ConsolePluginRegister, type PluginRegisterHostApi } from '@zhin.js/contract';
import type * as React from 'react';
import { AdapterConsolePage } from '../adapter-console/AdapterConsolePage.js';
import { getToken } from '../console-utils/remoteApi.js';
import { DeclarativePageView, type DeclarativePageComponentProps, type DeclarativePageSpec } from '../ui/declarative-page.js';

export type FetchConsoleEntriesOptions = {
  entriesUrl?: string;
  signal?: AbortSignal;
  fetchInit?: RequestInit | (() => RequestInit);
};

export type LoadConsoleEntriesOptions = FetchConsoleEntriesOptions & {
  /** Origin for `/@dev` / `/@assets` module URLs (Remote Console: Host API base). */
  assetOrigin?: string;
  hostApi: PluginRegisterHostApi;
  locale?: 'zh-CN' | 'en';
  beforeLoad?: () => void;
  onEmpty?: () => void;
  onFetchError?: (status: number) => void;
  onEntryError?: (entry: ConsoleClientEntry, error: unknown) => void;
};

export interface ConsoleEntryMetadataFields {
  readonly owner?: string;
  readonly route?: string;
  readonly title?: string;
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly icon?: string;
  readonly group?: string;
  readonly order?: number;
  readonly parent?: string | null;
  readonly fullWidth?: boolean;
  readonly hideInNav?: boolean;
  readonly requiredPermissions?: string[];
  readonly requiredRoles?: string[];
}

const CONSOLE_API_BASE_STORAGE_KEY = "zhin_api_base";

function resolveStoredApiBase(): string {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem(CONSOLE_API_BASE_STORAGE_KEY)?.trim();
  return stored ? stored.replace(/\/$/, "") : "";
}

function defaultEntriesUrl(): string {
  const apiBase = resolveStoredApiBase();
  if (apiBase) return `${apiBase}/entries`;
  const root = DEFAULT_CONSOLE_BASE_PATH.replace(/\/$/, "");
  return `${root ? `${root}/entries` : "/entries"}`;
}

function resolveRequestUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  if (typeof window === "undefined") return pathOrUrl;
  const apiBase = resolveStoredApiBase();
  const origin = apiBase || window.location.origin;
  return new URL(pathOrUrl, `${origin}/`).href;
}

function resolvePluginImportUrl(resolvedModule: string, assetOrigin?: string): string {
  if (resolvedModule.startsWith("http://") || resolvedModule.startsWith("https://")) return resolvedModule;
  if (typeof window === "undefined") return resolvedModule;
  const origin = assetOrigin?.replace(/\/$/, "") || window.location.origin;
  return new URL(resolvedModule, `${origin}/`).href;
}

function resolveFetchInit(init?: RequestInit | (() => RequestInit)): RequestInit {
  return typeof init === "function" ? init() : (init ?? {});
}

/**
 * The page list is filtered by the caller's token, so send the Console token unless the caller
 * already set its own Authorization header.
 */
function withConsoleToken(headers: HeadersInit | undefined): Headers {
  const result = new Headers(headers);
  if (!result.has("Authorization")) {
    const token = typeof window === "undefined" ? null : getToken();
    if (token) result.set("Authorization", `Bearer ${token}`);
  }
  return result;
}

export async function fetchConsoleEntries(
  options?: FetchConsoleEntriesOptions,
): Promise<ConsoleEntriesResponse> {
  const pathOrUrl = options?.entriesUrl ?? defaultEntriesUrl();
  const url = resolveRequestUrl(pathOrUrl);
  const init = resolveFetchInit(options?.fetchInit);
  const res = await fetch(url, {
    ...init,
    headers: withConsoleToken(init.headers),
    signal: options?.signal ?? init.signal,
  } as RequestInit);
  if (!res.ok) throw Object.assign(new Error(`load entries failed: ${res.status}`), { status: res.status });
  return (await res.json()) as ConsoleEntriesResponse;
}

export function getRegisterFn(mod: Record<string, unknown> | null | undefined): ConsolePluginRegister | null {
  if (!mod) return null;
  const r = mod["register"];
  if (typeof r === "function") return r as ConsolePluginRegister;
  const d = mod["default"] as Record<string, unknown> | undefined;
  if (d && typeof d["register"] === "function") return d["register"] as ConsolePluginRegister;
  return null;
}

/**
 * Convention pages (ADR 0046) export a React component as `default` + optional `meta`,
 * without a legacy `register(api)`. Synthesize register from entry.route / entry meta
 * so Remote Console can still mount them.
 */
export function resolveEntryRegister(
  mod: Record<string, unknown> | null | undefined,
  entry: ConsoleClientEntry & ConsoleEntryMetadataFields,
  locale?: 'zh-CN' | 'en',
): ConsolePluginRegister | null {
  const named = getRegisterFn(mod);
  if (named) return named;
  if (!mod) return null;
  const Component = mod["default"];
  if (typeof Component !== "function" && !(Component && typeof Component === "object")) {
    return null;
  }
  const path = typeof entry.route === "string" && entry.route
    ? entry.route
    : `/${entry.id}`;
  const meta = mod["meta"] && typeof mod["meta"] === "object"
    ? mod["meta"] as ConsoleEntryMetadataFields
    : undefined;
  const entryMeta = entry.meta && typeof entry.meta === "object"
    ? entry.meta as Record<string, unknown>
    : undefined;
  const titleI18n = meta?.titleI18n
    ?? entry.titleI18n
    ?? (entryMeta?.["titleI18n"] as Readonly<Partial<Record<'zh-CN' | 'en', string>>> | undefined);
  const localizedTitle = locale && titleI18n && typeof titleI18n[locale] === "string" && titleI18n[locale]
    ? titleI18n[locale]
    : undefined;
  const name = localizedTitle
    || (typeof meta?.title === "string" && meta.title)
    || (typeof entry.title === "string" && entry.title)
    || entry.meta?.name
    || entry.id;
  const icon = meta?.icon ?? entry.icon ?? (typeof entryMeta?.["icon"] === "string" ? entryMeta["icon"] : undefined);
  const group = meta?.group ?? entry.group ?? (typeof entryMeta?.["group"] === "string" ? entryMeta["group"] : undefined);
  const order = meta?.order ?? entry.order ?? (typeof entryMeta?.["order"] === "number" ? entryMeta["order"] : undefined);
  const parent = meta?.parent !== undefined ? meta.parent : entry.parent;
  const fullWidth = meta?.fullWidth ?? entry.fullWidth ?? (typeof entryMeta?.["fullWidth"] === "boolean" ? entryMeta["fullWidth"] : undefined);
  const hideInNav = meta?.hideInNav ?? entry.hideInNav ?? (entryMeta?.["hideInNav"] === true || entryMeta?.["hideInMenu"] === true);
  const requiredPermissions = meta?.requiredPermissions ?? entry.requiredPermissions;
  const requiredRoles = meta?.requiredRoles ?? entry.requiredRoles;
  return (api) => {
    const rawComp = Component as Record<string, unknown> | React.ComponentType;
    const isRawObject = typeof rawComp === 'object' && rawComp !== null;
    const pageProps: DeclarativePageComponentProps = {
      pluginId: entry.owner ?? entry.id,
      route: path,
      title: name,
    };
    const hasBlueprintKind = Boolean(
      rawComp &&
      (typeof rawComp === 'object' || typeof rawComp === 'function') &&
      typeof (rawComp as { kind?: unknown }).kind === 'string',
    );
    const element = isRawObject && (rawComp as { kind?: unknown }).kind === 'zhin.console.page-blueprint'
      ? api.React.createElement(DeclarativePageView as unknown as React.ComponentType<Record<string, unknown>>, {
          spec: (((rawComp as { reviewSpec?: unknown }).reviewSpec != null
            ? rawComp
            : ((rawComp as { spec?: DeclarativePageSpec }).spec ?? rawComp)) as DeclarativePageSpec),
          pageProps,
        })
      : isRawObject && (rawComp as { kind?: unknown }).kind === 'zhin.console.adapter-page'
        ? api.React.createElement(AdapterConsolePage as unknown as React.ComponentType<Record<string, unknown>>, {
            adapterKey: String((rawComp as { adapterKey?: unknown }).adapterKey ?? entry.id),
          })
        : (hasBlueprintKind || entry.owner !== undefined)
          ? api.React.createElement(Component as React.ComponentType<DeclarativePageComponentProps>, pageProps)
          : api.React.createElement(Component as React.ComponentType);
    api.addRoute({
      path,
      name,
      element,
      ...(icon != null ? { icon } : {}),
      ...(parent !== undefined ? { parent } : {}),
      ...(requiredPermissions !== undefined ? { requiredPermissions } : {}),
      ...(requiredRoles !== undefined ? { requiredRoles } : {}),
      meta: {
        hideInMenu: hideInNav === true,
        ...(titleI18n === undefined ? {} : { titleI18n }),
        ...(group === undefined ? {} : { group }),
        ...(order === undefined ? {} : { order }),
        ...(fullWidth === undefined ? {} : { fullWidth }),
      },
    });
  };
}

export async function registerConsolePluginsFromEntries(
  entries: ConsoleClientEntry[],
  hostApi: PluginRegisterHostApi,
  onEntryError?: (entry: ConsoleClientEntry, error: unknown) => void,
  assetOrigin?: string,
  locale?: 'zh-CN' | 'en',
): Promise<void> {
  if (!entries.length) return;
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const specifier = resolvePluginImportUrl(entry.resolvedModule, assetOrigin);
        const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
        const register = resolveEntryRegister(mod, entry, locale);
        if (register) await register(hostApi);
        else throw new Error(`entry "${entry.id}" has no register export`);
      } catch (error) {
        if (onEntryError) onEntryError(entry, error);
        else throw error;
      }
    }),
  );
}

const entryLoaderState: {
  activePromise: Promise<void> | null;
  lastOptions: LoadConsoleEntriesOptions | null;
} = {
  activePromise: null,
  lastOptions: null,
};

export async function loadConsoleEntries(options: LoadConsoleEntriesOptions): Promise<void> {
  entryLoaderState.lastOptions = options;
  options.beforeLoad?.();
  let data: ConsoleEntriesResponse;
  try {
    data = await fetchConsoleEntries(options);
  } catch (error) {
    entryLoaderState.activePromise = null;
    const status = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 0;
    if (options.onFetchError) {
      options.onFetchError(status);
      return;
    }
    throw error;
  }
  if (!data.entries?.length) {
    options.onEmpty?.();
    return;
  }
  try {
    await registerConsolePluginsFromEntries(
      data.entries,
      options.hostApi,
      options.onEntryError,
      options.assetOrigin,
      options.locale,
    );
  } catch (error) {
    entryLoaderState.activePromise = null;
    throw error;
  }
}

export async function reloadConsoleEntries(options?: LoadConsoleEntriesOptions): Promise<void> {
  entryLoaderState.activePromise = null;
  const resolved = options ?? entryLoaderState.lastOptions;
  if (!resolved) return;
  entryLoaderState.activePromise = loadConsoleEntries(resolved).catch((error) => {
    entryLoaderState.activePromise = null;
    throw error;
  });
  return entryLoaderState.activePromise;
}

export const CONSOLE_ENTRY_LIFECYCLE_EVENTS = [
  'plugin:installed',
  'plugin:uninstalled',
  'plugin:lifecycle-updated',
] as const;

export function subscribeConsoleEntryReload(
  transport: { onConsoleEvent: (type: string, listener: () => void) => () => void },
  options?: LoadConsoleEntriesOptions | (() => LoadConsoleEntriesOptions | undefined),
): () => void {
  const unsubscribes = CONSOLE_ENTRY_LIFECYCLE_EVENTS.map((eventType) =>
    transport.onConsoleEvent(eventType, () => {
      const resolved = typeof options === 'function' ? options() : options;
      void reloadConsoleEntries(resolved).catch(() => {});
    }),
  );
  return () => {
    for (const unsub of unsubscribes) unsub();
  };
}
