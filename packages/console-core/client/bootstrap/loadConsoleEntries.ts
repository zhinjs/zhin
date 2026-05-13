import type {
  ConsoleClientEntry,
  ConsoleEntriesResponse,
  ConsolePluginRegister,
  PluginRegisterHostApi,
} from "@zhin.js/console-types";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

export type FetchConsoleEntriesOptions = {
  entriesUrl?: string;
  signal?: AbortSignal;
  fetchInit?: RequestInit | (() => RequestInit);
};

export type LoadConsoleEntriesOptions = FetchConsoleEntriesOptions & {
  hostApi: PluginRegisterHostApi;
  beforeLoad?: () => void;
  onEmpty?: () => void;
  onFetchError?: (status: number) => void;
  onEntryError?: (entry: ConsoleClientEntry, error: unknown) => void;
};

export type CreatePluginRegisterHostApiOptions = {
  React: PluginRegisterHostApi["React"];
  addRoute: PluginRegisterHostApi["addRoute"];
  addTool: PluginRegisterHostApi["addTool"];
};

export function createPluginRegisterHostApi(
  options: CreatePluginRegisterHostApiOptions,
): PluginRegisterHostApi {
  const addRoute = options.addRoute;
  return {
    React: options.React,
    addRoute,
    addPage: addRoute,
    addTool: options.addTool,
  };
}

function resolveRequestUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  if (typeof window === "undefined") return pathOrUrl;
  return new URL(pathOrUrl, window.location.origin).href;
}

function resolvePluginImportUrl(resolvedModule: string): string {
  if (resolvedModule.startsWith("http://") || resolvedModule.startsWith("https://")) return resolvedModule;
  if (typeof window === "undefined") return resolvedModule;
  return new URL(resolvedModule, window.location.origin).href;
}

function resolveFetchInit(init?: RequestInit | (() => RequestInit)): RequestInit {
  return typeof init === "function" ? init() : (init ?? {});
}

export async function fetchConsoleEntries(
  options?: FetchConsoleEntriesOptions,
): Promise<ConsoleEntriesResponse> {
  const pathOrUrl = options?.entriesUrl ?? `${DEFAULT_CONSOLE_BASE_PATH}/entries`;
  const url = resolveRequestUrl(pathOrUrl);
  const init = resolveFetchInit(options?.fetchInit);
  const res = await fetch(url, {
    credentials: "include",
    ...init,
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

export async function registerConsolePluginsFromEntries(
  entries: ConsoleClientEntry[],
  hostApi: PluginRegisterHostApi,
  onEntryError?: (entry: ConsoleClientEntry, error: unknown) => void,
): Promise<void> {
  if (!entries.length) return;
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const specifier = resolvePluginImportUrl(entry.resolvedModule);
        const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
        const register = getRegisterFn(mod);
        if (register) await register(hostApi);
        else throw new Error(`entry "${entry.id}" has no register export`);
      } catch (error) {
        if (onEntryError) onEntryError(entry, error);
        else throw error;
      }
    }),
  );
}

export async function loadConsoleEntries(options: LoadConsoleEntriesOptions): Promise<void> {
  options.beforeLoad?.();
  let data: ConsoleEntriesResponse;
  try {
    data = await fetchConsoleEntries(options);
  } catch (error) {
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
  await registerConsolePluginsFromEntries(data.entries, options.hostApi, options.onEntryError);
}

