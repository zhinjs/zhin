import { DatabaseFeature, type Plugin } from "zhin.js";
import { resolvePlaygroundDatabaseConfig } from "./resolve-database-config.ts";

/** 在 initAgentModule 之前注册 DatabaseFeature（与 packages/zhin apply-config-and-database 一致） */
export function applyPlaygroundDatabase(
  plugin: Plugin,
  appConfig: Record<string, unknown>,
): boolean {
  const database = resolvePlaygroundDatabaseConfig(appConfig);
  if (!database?.dialect) return false;
  plugin.provide(new DatabaseFeature(database as ConstructorParameters<typeof DatabaseFeature>[0]));
  return true;
}
