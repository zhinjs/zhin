import * as React from "react";
import { configureConsole } from "@zhin.js/console-core/browser";
import type {
  ConsoleClientEntry,
  ConsolePluginRegister,
  PluginRegisterHostApi,
  ConsoleEntriesResponse,
} from "@zhin.js/console-types";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";
import { app } from "@zhin.js/client";

export type FetchConsoleEntriesOptions = {
  entriesUrl?: string;
  signal?: AbortSignal;
};

const addRoute = app.addRoute.bind(app);
const defaultHostRegisterApi: PluginRegisterHostApi = {
  React,
  addRoute,
  addPage: addRoute,
  addTool: app.addTool.bind(app),
};

function resolveRequestUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  if (typeof window === "undefined") return pathOrUrl;
  return new URL(pathOrUrl, window.location.origin).href;
}

export async function fetchConsoleEntries(
  options?: FetchConsoleEntriesOptions,
): Promise<ConsoleEntriesResponse> {
  const pathOrUrl = options?.entriesUrl ?? `${DEFAULT_CONSOLE_BASE_PATH}/entries`;
  const url = resolveRequestUrl(pathOrUrl);
  const res = await fetch(url, {
    credentials: "include",
    signal: options?.signal,
  } as RequestInit);
  if (!res.ok) throw new Error(`load entries failed: ${res.status}`);
  return (await res.json()) as ConsoleEntriesResponse;
}

function getRegisterFn(mod: Record<string, unknown> | null | undefined): ConsolePluginRegister | null {
  if (!mod) return null;
  const r = mod["register"];
  if (typeof r === "function") return r as ConsolePluginRegister;
  const d = mod["default"] as Record<string, unknown> | undefined;
  if (d && typeof d["register"] === "function") return d["register"] as ConsolePluginRegister;
  return null;
}

function resolvePluginImportUrl(resolvedModule: string): string {
  if (resolvedModule.startsWith("http://") || resolvedModule.startsWith("https://")) return resolvedModule;
  if (typeof window === "undefined") return resolvedModule;
  return new URL(resolvedModule, window.location.origin).href;
}

export async function registerConsolePluginsFromEntries(
  entries: ConsoleClientEntry[],
  hostApi: PluginRegisterHostApi = defaultHostRegisterApi,
): Promise<void> {
  if (!entries.length) return;
  await Promise.all(
    entries.map(async (e) => {
      try {
        const specifier = resolvePluginImportUrl(e.resolvedModule);
        const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
        const register = getRegisterFn(mod);
        if (register) {
          await register(hostApi);
        } else {
          console.error(`[zhin-console] entry "${e.id}" has no register export, keys=`, mod && Object.keys(mod));
        }
      } catch (err) {
        console.error(`[zhin-console] Failed to load plugin "${e.id}":`, err);
      }
    }),
  );
}

let entriesLoadInflight: Promise<void> | null = null;

export function loadConsoleEntries(options?: FetchConsoleEntriesOptions): Promise<void> {
  if (entriesLoadInflight) return entriesLoadInflight;
  entriesLoadInflight = runLoadConsoleEntries(options).finally(() => {
    entriesLoadInflight = null;
  });
  return entriesLoadInflight;
}

async function runLoadConsoleEntries(options?: FetchConsoleEntriesOptions) {
  configureConsole({
    getRuntimeEnv: () =>
      (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "development"
        ? "development"
        : "production",
  });

  const data = await fetchConsoleEntries(options);

  if (!data.entries?.length) {
    console.warn("[zhin-console] /entries returned empty list.");
    return;
  }

  await registerConsolePluginsFromEntries(data.entries, defaultHostRegisterApi);
}
