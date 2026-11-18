import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, unknown>;
  publishConfig: { exports: Record<string, unknown> };
};

describe('@zhin.js/client root entry', () => {
  it('exports the data, locale, plugin ID helpers and the declarative renderer (ADR 0063 D14)', async () => {
    const root = await import('./index.js');
    for (const name of [
      'usePluginRpc', 'usePluginData', 'useRpcResource', 'useLocale', 'detectLocale', 'translate', 'formatClock',
      'resolvePluginId', 'resolveSyncPluginId', 'resolveAdapterConsolePluginId',
      'DeclarativePageView', 'createDeclarativePage', 'DataTable', 'DECLARATIVE_PAGE_CAPABILITIES',
      'AdapterConsolePage', 'ADAPTER_CONSOLE_PAGE_CAPABILITIES', 'createCommentReviewPage',
    ]) expect((root as Record<string, unknown>)[name], name).toBeDefined();
    expect(root.ADAPTER_CONSOLE_PAGE_CAPABILITIES.pageChrome).toBe(true);
    expect(root.DECLARATIVE_PAGE_CAPABILITIES.pageChrome).toBe(true);
  });

  it('no longer has the names removed in ADR 0063 P4', async () => {
    const root = await import('./index.js') as Record<string, unknown>;
    for (const name of ['adapterConsoleStyles', 'conversationPickerStyles', 'pluginUiStyles']) expect(root[name], name).toBeUndefined();
    expect(Object.keys(pkg.exports)).toEqual(['.']);
    expect(Object.keys(pkg.publishConfig.exports)).toEqual(['.']);
  });
});
