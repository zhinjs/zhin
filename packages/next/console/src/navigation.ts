import type { NavNode, PageManifest } from '@zhin.js/next-console-contract';
import type { PluginId, PluginNodeSnapshot, RuntimeSnapshot } from '@zhin.js/next-kernel';

export function buildNavigation(
  snapshot: RuntimeSnapshot,
  pages: readonly Readonly<PageManifest>[],
): readonly Readonly<NavNode>[] {
  const byOwner = new Map<string, PageManifest[]>();
  for (const page of pages) {
    if (page.hideInNav) continue;
    const owned = byOwner.get(page.owner) ?? [];
    owned.push(page);
    byOwner.set(page.owner, owned);
  }

  const visit = (id: PluginId): Readonly<NavNode> | undefined => {
    const plugin = requiredPlugin(snapshot, id);
    const leaves = (byOwner.get(id) ?? []).map(pageNode);
    const groups = plugin.children
      .map(visit)
      .filter((node): node is Readonly<NavNode> => node !== undefined);
    const children = Object.freeze([...leaves, ...groups].sort(compareNode));
    if (children.length === 0) return undefined;
    return Object.freeze({
      id: plugin.id,
      type: 'plugin' as const,
      label: plugin.metadata?.displayName ?? plugin.instanceKey,
      icon: plugin.metadata?.icon,
      order: plugin.metadata?.order ?? 100,
      children,
    });
  };

  const root = requiredPlugin(snapshot, snapshot.root);
  const rootPages = (byOwner.get(snapshot.root) ?? []).map(pageNode);
  const groups = root.children
    .map(visit)
    .filter((node): node is Readonly<NavNode> => node !== undefined);
  return Object.freeze([...rootPages, ...groups].sort(compareNode));
}

function pageNode(page: PageManifest): Readonly<NavNode> {
  return Object.freeze({
    id: page.id,
    type: 'page' as const,
    label: page.title,
    icon: page.icon,
    path: page.route,
    order: page.order,
    children: Object.freeze([]),
  });
}

function compareNode(left: NavNode, right: NavNode): number {
  return left.order - right.order
    || left.type.localeCompare(right.type)
    || left.id.localeCompare(right.id);
}

function requiredPlugin(snapshot: RuntimeSnapshot, id: PluginId): PluginNodeSnapshot {
  const node = snapshot.tree.get(id);
  if (!node) throw new Error(`Unknown Plugin in Console tree: ${id}`);
  return node;
}
