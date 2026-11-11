import {
  buildConsolePluginPermissionCatalog,
  normalizeConsolePluginPermissionDeclaration,
  type ConsolePluginPermissionDeclaration,
  type ConsolePluginPermissionInfo,
} from '@zhin.js/console-protocol';
import { ConsoleCatalog } from '@zhin.js/pagemanager/plugin-runtime';
import type { PluginConsoleRpc, PluginId, RuntimeSnapshot, SnapshotLease, SnapshotReader } from '@zhin.js/plugin-runtime';
import { ownProvider, type HostConsoleRpcFactory } from './plugin-console-rpc.js';

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });

/**
 * Plugin permission catalog of one generation (ADR 0049 amendment 2026-11-11): every
 * `<plugin>:<action>` string a page or Console RPC method requires, plus the levels plugins
 * declare through `definePluginConsoleRpc({ permissions })`. Undeclared ones get inferred levels.
 */
export function collectPluginPermissionCatalog(
  snapshot: RuntimeSnapshot,
  hostRpc?: PluginConsoleRpc,
): readonly ConsolePluginPermissionInfo[] {
  const uses: Array<{ owner: string; permission: string }> = [];
  const declarations: Array<{ owner: string; declaration: ConsolePluginPermissionDeclaration }> = [];
  const addRpc = (owner: string, rpc: PluginConsoleRpc | undefined) => {
    if (!rpc) return;
    for (const method of rpc.methods.values()) {
      for (const permission of [...method.requiredPermissions, ...method.anyOfPermissions]) uses.push({ owner, permission });
    }
    for (const declared of rpc.permissions ?? []) {
      try {
        declarations.push({ owner, declaration: normalizeConsolePluginPermissionDeclaration(declared) });
      } catch { /* definePluginConsoleRpc validated it; a hand-built surface is ignored */ }
    }
  };
  let catalog: ConsoleCatalog | undefined;
  try { catalog = new ConsoleCatalog(snapshot, publicAccess); } catch { catalog = undefined; }
  for (const id of snapshot.tree.keys()) {
    try { addRpc(id, ownProvider(snapshot, id as PluginId)); } catch { /* invalid surface: nothing to collect */ }
    try {
      for (const page of catalog?.pagesOwnedBy(id as PluginId) ?? []) {
        for (const permission of page.requiredPermissions) uses.push({ owner: id, permission });
      }
    } catch { /* inactive catalog */ }
  }
  addRpc(snapshot.root, hostRpc);
  return buildConsolePluginPermissionCatalog(uses, declarations);
}

/** Per-generation cached catalog source for `TokenRegistry.usePluginPermissions`. */
export function createPluginPermissionCatalogSource(options: Readonly<{
  snapshots: SnapshotReader;
  hostConsoleRpc?: HostConsoleRpcFactory;
}>): () => readonly ConsolePluginPermissionInfo[] {
  let cached: { generation: number; catalog: readonly ConsolePluginPermissionInfo[] } | undefined;
  return () => {
    let lease: SnapshotLease | undefined;
    try {
      lease = options.snapshots.acquire();
    } catch {
      return cached?.catalog ?? Object.freeze([]);
    }
    try {
      const snapshot = lease.value;
      if (cached?.generation === snapshot.generation) return cached.catalog;
      let hostRpc: PluginConsoleRpc | undefined;
      try { hostRpc = options.hostConsoleRpc?.(lease); } catch { hostRpc = undefined; }
      const catalog = collectPluginPermissionCatalog(snapshot, hostRpc);
      cached = { generation: snapshot.generation, catalog };
      return catalog;
    } finally {
      lease.release();
    }
  };
}
