/**
 * One console warning per deprecation per page load (ADR 0063 P2: `@zhin.js/client/ui`, `zk-`
 * classes and the blueprint `mark` are deprecated and removed in a later minor, P4).
 */
const KEY = '__ZHIN_CLIENT_DEPRECATIONS__';

function seen(): Set<string> {
  const scope = globalThis as Record<string, unknown>;
  let set = scope[KEY] as Set<string> | undefined;
  if (!(set instanceof Set)) {
    set = new Set<string>();
    scope[KEY] = set;
  }
  return set;
}

/** Warns once for `id`; returns whether this call warned. */
export function warnDeprecatedOnce(id: string, message: string): boolean {
  const warned = seen();
  if (warned.has(id)) return false;
  warned.add(id);
  globalThis.console?.warn?.(`[@zhin.js/client] ${message}`);
  return true;
}

/** Test helper: forget the warnings already given. */
export function resetDeprecationWarnings(): void {
  seen().clear();
}

export const BLUEPRINT_MARK_DEPRECATION =
  'Page blueprint field `mark` is deprecated and ignored: the letter tile was removed and the page shell renders the header (ADR 0063). Remove `mark`; it will be deleted in a later minor.';

export const CLIENT_UI_DEPRECATION =
  '`@zhin.js/client/ui` is deprecated (ADR 0063): import usePluginRpc, usePluginData, useRpcResource, useLocale, translate, resolvePluginId, DeclarativePageView, createDeclarativePage and DataTable from `@zhin.js/client`, and components from `@zhin.js/console-ui`. The `zk-` components and classes will be removed in a later minor.';
