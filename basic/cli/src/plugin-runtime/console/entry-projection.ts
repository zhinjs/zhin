import type { RuntimeConsolePage } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });

export async function listPages(consoleRuntime: ConsoleRuntime): Promise<readonly RuntimeConsolePage[]> {
  const pages = await consoleRuntime.runView(publicAccess, (catalog) => catalog.pages());
  return Object.freeze(pages.map((page) => Object.freeze({
    id: page.id,
    localName: page.localName,
    title: page.title,
    route: page.route,
    module: page.module,
    order: page.order,
    hash: page.hash,
  })));
}

/** Console shell entry shape consumed by `@zhin.js/contract` clients. */
export type ConsoleEntryBody = {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly module: string;
  readonly resolvedModule: string;
  readonly order: number;
  readonly enabled: boolean;
  readonly meta: { readonly name: string };
  readonly route: string;
  readonly hash: string;
};

export type ConsoleEntriesBody = {
  readonly entries: readonly ConsoleEntryBody[];
  readonly runtimeEnvHint: 'development' | 'production';
};

/** Maps the current page catalog to the Console entry discovery response. */
export function buildConsoleEntriesBody(
  pages: readonly RuntimeConsolePage[],
  runtimeEnvHint: 'development' | 'production' = defaultRuntimeEnvHint(),
): ConsoleEntriesBody {
  const entries = [...pages]
    .sort((a, b) => a.order - b.order)
    .map((page) => Object.freeze({
      id: page.localName,
      name: page.localName,
      title: page.title,
      module: page.module,
      resolvedModule: page.module,
      order: page.order,
      enabled: true,
      meta: Object.freeze({ name: page.title }),
      route: page.route,
      hash: page.hash,
    }));
  return Object.freeze({ entries: Object.freeze(entries), runtimeEnvHint });
}

function defaultRuntimeEnvHint(): 'development' | 'production' {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
    ? 'production'
    : 'development';
}
