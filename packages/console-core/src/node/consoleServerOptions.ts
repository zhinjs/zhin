import type Router from "@koa/router";
import type Koa from "koa";
import type { RuntimeEnv } from "@zhin.js/console-types";
import type { EntryStore } from "./entryStore.js";

export type PluginServerRegisterHostApi = {
  router: Router;
  entryStore: EntryStore;
  basePath: string;
  runtimeEnvHint?: RuntimeEnv;
};

export type PluginServerRegister = (api: PluginServerRegisterHostApi) => void | Promise<void>;

export type ConsoleServerRouteRegistrar = (ctx: PluginServerRegisterHostApi) => void | Promise<void>;

export type ConsoleServerOptions = {
  path?: string;
  router?: Router;
  runtimeEnvHint?: RuntimeEnv;
  clientPackageRoot: string;
  koa: Koa;
  farmConfigPath?: string;
  mode?: "development" | "production";
  logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  serverRouteRegistrars?: ConsoleServerRouteRegistrar[];
  port?: number;
  farmServerPort?: number;
  farmStrictPort?: boolean;
};

export type ConsoleClientHostAttachOptions = {
  clientPackageRoot: string;
  farmConfigPath?: string;
  mode?: "development" | "production";
  farmLogger?: unknown;
  port?: number;
  farmServerPort?: number;
  farmStrictPort?: boolean;
  consoleBasePath?: string;
};

export type ConsoleClientHostAttachment = {
  bindDevWebSocket(server: import("node:http").Server): void;
  prepareListen(): Promise<void>;
  close(): Promise<void>;
};
