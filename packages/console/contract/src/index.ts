export {
  DEFAULT_CONSOLE_BASE_PATH,
  CONSOLE_HOST_REACT_NAMESPACE_KEY,
  CONSOLE_SHARED_MODULES_KEY,
  SIDE_EVENT_PUSH,
  SIDE_EVENT_RPC,
  INBOX_RPC,
  ENDPOINT_RPC,
  SIDE_EVENT_NAMES,
} from "./constants.js";

export type RuntimeEnv = "development" | "production";

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

export type ConsoleClientEntry = Omit<ConsoleEntry, "serverPaths"> & {
  resolvedModule: string;
};

export type PluginAddRouteInput = {
  path: string;
  name: string;
  element: import('react').ReactNode;
  parent?: string | null;
  icon?: import('react').ReactNode | string;
  meta?: {
    hideInMenu?: boolean;
    titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
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
  icon?: import('react').ReactNode;
  parent?: string | null;
  path?: string;
};

export type PluginRegisterHostApi = {
  React: typeof import("react");
  addRoute(input: PluginAddRouteInput): void;
  addTool(input: PluginAddToolInput): string;
};

export type ConsolePluginRegister = (api: PluginRegisterHostApi) => void | Promise<void>;

export type ConsoleEntriesResponse = {
  entries: ConsoleClientEntry[];
  runtimeEnvHint: RuntimeEnv | null;
};
