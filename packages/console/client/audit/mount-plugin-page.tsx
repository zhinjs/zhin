/**
 * Mount module for the plugin page layout audit of `@zhin.js/console-ui/audit`
 * (`ZHIN_UI_AUDIT_MOUNT_MODULE=packages/console/client/audit/mount-plugin-page.tsx`).
 *
 * Renders a plugin page module the way the Console does, with fixture data instead of a Host
 * (see `fixtures.ts`): declarative blueprints through `DeclarativePageView`, comment review pages
 * (blueprints with `reviewSpec`) through the same renderer, adapter pages through
 * `AdapterConsolePage`, hand-written components directly. The audit's `renderInShell` wraps the body
 * in the console-ui `PageShell` + `PageChromeProvider`, so the renderers run in content mode.
 */
import React from 'react';
import { AdapterConsolePage } from '../client/adapter-console/AdapterConsolePage.js';
import { DeclarativePageView } from '../client/declarative/index.js';
import type { DeclarativePageSpec } from '../client/declarative/index.js';
import { adapterFixture, blueprintFixture, installFixtureHost, reviewFixture } from './fixtures.js';

export interface MountPluginPageContext {
  readonly element: HTMLElement;
  readonly pageModule: { readonly default?: unknown; readonly meta?: Record<string, unknown> };
  readonly pageName?: string;
  readonly theme: 'light' | 'dark';
  readonly renderInShell: (body: React.ReactNode) => void;
}

type Blueprint = { readonly kind?: unknown; readonly adapterKey?: unknown; readonly reviewSpec?: { readonly adapter?: unknown } | null; readonly spec?: unknown };

/** Kind of page a module default-exports: what renders it and which fixture it needs. */
export function classifyPage(page: unknown): 'adapter' | 'review' | 'blueprint' | 'component' | 'unknown' {
  const bp = page as Blueprint | undefined;
  const kind = bp && (typeof bp === 'object' || typeof bp === 'function') ? bp.kind : undefined;
  if (kind === 'zhin.console.adapter-page') return 'adapter';
  if (kind === 'zhin.console.page-blueprint') return bp?.reviewSpec != null ? 'review' : 'blueprint';
  if (typeof page === 'function') return 'component';
  return 'unknown';
}

export async function mountPluginPage({ pageModule, pageName, renderInShell }: MountPluginPageContext): Promise<void> {
  const page = pageModule.default;
  const bp = page as Blueprint;
  switch (classifyPage(page)) {
    case 'adapter': {
      const adapterKey = String(bp.adapterKey ?? pageName ?? '');
      const fixture = adapterFixture(adapterKey);
      installFixtureHost({ adapter: adapterKey, status: fixture.status, endpoints: fixture.endpoints });
      renderInShell(<AdapterConsolePage adapterKey={adapterKey} />);
      return;
    }
    case 'review': {
      const adapter = String(bp.reviewSpec?.adapter ?? pageName ?? 'review');
      installFixtureHost({ adapter, status: reviewFixture() });
      renderInShell(<DeclarativePageView spec={bp as unknown as DeclarativePageSpec} pageProps={{ pluginId: `root/${adapter}` }} />);
      return;
    }
    case 'blueprint': {
      const spec = (bp.spec ?? bp) as DeclarativePageSpec;
      installFixtureHost({ status: blueprintFixture(page) });
      renderInShell(<DeclarativePageView spec={spec} pageProps={{ pluginId: 'root/audit-fixture' }} />);
      return;
    }
    case 'component': {
      installFixtureHost({ status: {} });
      const Component = page as React.ComponentType;
      renderInShell(<Component />);
      return;
    }
    default:
      throw new Error(`page ${pageName ?? ''} has no default-exported component or blueprint`);
  }
}
