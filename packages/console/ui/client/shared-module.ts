import { CONSOLE_UI_VERSION } from './version.js';

/** Module id under which the Console shares this package with plugin pages (ADR 0063 D3). */
export const CONSOLE_UI_MODULE_ID = '@zhin.js/console-ui';

/**
 * Global the Console fills with the versions of the modules it shares
 * (`Map<moduleId, version>`), next to `__ZHIN_CONSOLE_SHARED_MODULES__`.
 * `@zhin.js/pagemanager` reads the same key in its generated proxy modules.
 */
export const CONSOLE_SHARED_MODULE_VERSIONS_KEY = '__ZHIN_CONSOLE_SHARED_MODULE_VERSIONS__';

/** Event the proxy modules dispatch on `globalThis` when a plugin page's peer range is not met. */
export const CONSOLE_SHARED_MODULE_ISSUE_EVENT = 'zhin:console-shared-module-issue';

/** Global array the proxy modules append those issues to (for a page or the shell to show). */
export const CONSOLE_SHARED_MODULE_ISSUES_KEY = '__ZHIN_CONSOLE_SHARED_MODULE_ISSUES__';

export interface ConsoleSharedModuleIssue {
  /** `major`: incompatible (the page does not load); `minor`: older than the range asks for; `range`: outside the range otherwise; `export`: named exports missing; `unversioned`: the Console did not register a version. */
  readonly kind: 'major' | 'minor' | 'range' | 'export' | 'unversioned';
  readonly module: string;
  readonly hostVersion?: string;
  readonly range?: string;
  /** Package that declared the range (the plugin). */
  readonly consumer?: string;
  readonly missingExports?: readonly string[];
  readonly message: string;
}

/**
 * Registers this package (module namespace and version) in the Console's shared-module tables.
 * Call it once in the Console entry before plugin entries load.
 */
export function registerConsoleUiSharedModule(
  moduleNamespace: unknown,
  sharedModules: Map<string, unknown>,
  target: Record<string, unknown> = globalThis as Record<string, unknown>,
): void {
  sharedModules.set(CONSOLE_UI_MODULE_ID, moduleNamespace);
  const existing = target[CONSOLE_SHARED_MODULE_VERSIONS_KEY];
  const versions = existing instanceof Map ? existing as Map<string, string> : new Map<string, string>();
  versions.set(CONSOLE_UI_MODULE_ID, CONSOLE_UI_VERSION);
  target[CONSOLE_SHARED_MODULE_VERSIONS_KEY] = versions;
}
