import path from 'node:path';
import {
  Adapter,
  listEndpointManagementCapabilities,
  type Plugin,
  type ConfigFeature,
} from '@zhin.js/core';
import type { ConsoleEndpointSummary } from '@zhin.js/console-protocol';
import type { ConsoleRpcContext } from './context.js';
export function resolveConfigKey(root: Plugin, pluginName: string): string {
  const schemaService = root.inject("schema");
  return schemaService?.resolveConfigKey(pluginName) ?? pluginName;
}

export function getPluginKeys(root: Plugin): string[] {
  const schemaService = root.inject("schema");
  if (!schemaService) return [];
  const keys = new Set<string>();
  for (const [, configKey] of schemaService.getPluginKeyMap()) {
    keys.add(configKey);
  }
  return Array.from(keys);
}

export function getConfigFilePath(ctx: ConsoleRpcContext): string {
  const configService = ctx.root.inject("config") as ConfigFeature | undefined;
  const primaryFile = configService?.primaryFile || "zhin.config.yml";
  return path.resolve(ctx.projectFs.cwd(), primaryFile);
}

export function findPluginByConfigKey(rootPlugin: Plugin, configKey: string): Plugin | null {
  for (const child of rootPlugin.children) {
    if (child.name === configKey || child.name.endsWith(`-${configKey}`) || child.name.includes(configKey)) {
      return child;
    }
    const found = findPluginByConfigKey(child, configKey);
    if (found) return found;
  }
  return null;
}

export function collectEndpointsList(root: Plugin): ConsoleEndpointSummary[] {
  const endpoints: ConsoleEndpointSummary[] = [];
  const seenAdapterNames = new Set<string>();
  for (const name of root.adapters) {
    const key = String(name);
    if (seenAdapterNames.has(key)) continue;
    seenAdapterNames.add(key);
    const adapter = root.inject(name as keyof Plugin.Contexts);
    if (adapter instanceof Adapter) {
      for (const [endpointId, endpoint] of adapter.endpoints.entries()) {
        endpoints.push({
          name: endpointId,
          adapter: key,
          connected: !!(endpoint as { $connected?: boolean }).$connected,
          status: (endpoint as { $connected?: boolean }).$connected ? "online" : "offline",
          managementCapabilities: listEndpointManagementCapabilities(endpoint),
        });
      }
    }
  }
  return endpoints;
}

export async function collectEndpointsListWithPending(root: Plugin) {
  const endpoints = collectEndpointsList(root);
  let reqs: Awaited<ReturnType<typeof listUnconsumedRequests>> = [];
  let notices: Awaited<ReturnType<typeof listUnconsumedNotices>> = [];
  try {
    const persistence = await import("../endpoint-persistence.js");
    [reqs, notices] = await Promise.all([
      persistence.listUnconsumedRequests(),
      persistence.listUnconsumedNotices(),
    ]);
  } catch {
    // 无 DB 时忽略
  }
  return endpoints.map((ep) => ({
    ...ep,
    pendingRequestCount: reqs.filter(
      (r) => r.adapter === ep.adapter && r.endpoint_id === ep.name,
    ).length,
    pendingNoticeCount: notices.filter(
      (n) => n.adapter === ep.adapter && n.endpoint_id === ep.name,
    ).length,
  }));
}
