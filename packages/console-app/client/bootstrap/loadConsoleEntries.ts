import * as React from "react";
import {
  configureConsole,
  createPluginRegisterHostApi,
  fetchConsoleEntries as fetchEntriesFromCore,
  loadConsoleEntries as loadEntriesFromCore,
  registerConsolePluginsFromEntries,
  type FetchConsoleEntriesOptions,
} from "@zhin.js/console-core/browser";
import { app } from "@zhin.js/client";

const addRoute = app.addRoute.bind(app);
const defaultHostRegisterApi = createPluginRegisterHostApi({
  React,
  addRoute,
  addTool: app.addTool.bind(app),
});

export type { FetchConsoleEntriesOptions };
export { registerConsolePluginsFromEntries };

export async function fetchConsoleEntries(options?: FetchConsoleEntriesOptions) {
  return fetchEntriesFromCore(options);
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
  await loadEntriesFromCore({
    ...options,
    hostApi: defaultHostRegisterApi,
    beforeLoad: () => {
      configureConsole({
        getRuntimeEnv: () =>
          (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "development"
            ? "development"
            : "production",
      });
    },
    onEmpty: () => console.warn("[zhin-console] /entries returned empty list."),
    onEntryError: (entry, error) => console.error(`[zhin-console] Failed to load plugin "${entry.id}":`, error),
  });
}
