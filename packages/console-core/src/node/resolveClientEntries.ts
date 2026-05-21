import type {
  ConsoleClientEntry,
  ConsoleEntry,
  EntryModuleSpec,
  RuntimeEnv,
} from "@zhin.js/console-types";
import { joinConsolePublicPath } from "./esmForBrowser.js";

export function chooseModule(spec: EntryModuleSpec, runtime: RuntimeEnv): string {
  if (typeof spec === "string") return spec;
  if (runtime === "development") return spec.dev;
  return spec.prod ?? spec.dev;
}

export function chooseFsPath(
  paths: NonNullable<ConsoleEntry["paths"]>,
  runtime: RuntimeEnv,
): string {
  return runtime === "development" ? paths.development : paths.production;
}

export function rewriteEntriesForClient(options: {
  entries: ConsoleEntry[];
  serverEnv: RuntimeEnv;
  basePath: string;
}): ConsoleClientEntry[] {
  const { entries, serverEnv, basePath } = options;

  return entries.map((e) => {
    const { serverPaths: _serverPaths, ...eForClient } = e;
    if (e.paths) {
      const resolvedModule =
        serverEnv === "development"
          ? joinConsolePublicPath(basePath, `@dev/${e.id}.mjs`)
          : joinConsolePublicPath(basePath, `@assets/${e.id}.mjs`);
      return { ...eForClient, packageEntry: undefined, resolvedModule };
    }

    const chosen = chooseModule(e.module!, serverEnv);
    return { ...eForClient, resolvedModule: chosen };
  });
}
