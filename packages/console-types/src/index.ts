export { DEFAULT_CONSOLE_BASE_PATH, CONSOLE_HOST_REACT_NAMESPACE_KEY, CONSOLE_SHARED_MODULES_KEY } from "./constants.js";

export type RuntimeEnv = "development" | "production";

export type ConsoleUser = {
  id: string;
  name: string;
  roles?: string[];
  permissions: string[];
};

export type ConsoleAuthContext = unknown;

export type ConsoleAuthAdapter = {
  getUser(ctx: ConsoleAuthContext): Promise<ConsoleUser | null> | ConsoleUser | null;
  hasPermission(user: ConsoleUser, permission: string): boolean;
};

export type EntryModuleSpec =
  | string
  | {
      dev: string;
      prod?: string;
    };

export type ConsoleEntryPaths = {
  development: string;
  production: string;
};

export type ConsoleEntry = {
  id: string;
  paths?: ConsoleEntryPaths;
  serverPaths?: { development: string; production: string };
  module?: EntryModuleSpec;
  packageEntry?: string;
  order?: number;
  enabled?: boolean;
  meta?: { name?: string; version?: string };
  requiredPermissions?: string[];
};

export type ConsoleFileAddEntryInput = {
  id?: string;
  development: string;
  production: string;
  serverDevelopment?: string;
  serverProduction?: string;
  order?: number;
  enabled?: boolean;
  meta?: { name?: string; version?: string };
  requiredPermissions?: string[];
};

export type ConsoleClientEntry = Omit<ConsoleEntry, "serverPaths"> & {
  resolvedModule: string;
};

export type PluginAddRouteInput = {
  path: string;
  name: string;
  element: unknown;
  parent?: string | null;
  icon?: unknown;
  meta?: {
    hideInMenu?: boolean;
    order?: number;
    group?: string;
    fullWidth?: boolean;
  };
  requiredPermissions?: string[];
  requiredRoles?: string[];
};

export type PluginAddToolInput = {
  id?: string;
  name: string;
  icon?: unknown;
  parent?: string | null;
  path?: string;
};

export type PluginRegisterHostApi = {
  React: typeof import("react");
  addRoute(input: PluginAddRouteInput): void;
  /** 与旧版控制台 register(api) 对齐，等价于 addRoute */
  addPage(input: PluginAddRouteInput): void;
  addTool(input: PluginAddToolInput): string;
};

export type ConsolePluginRegister = (api: PluginRegisterHostApi) => void | Promise<void>;

export type ConsoleEntriesResponse = {
  entries: ConsoleClientEntry[];
  runtimeEnvHint: RuntimeEnv | null;
};
