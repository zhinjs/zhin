import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHookEnv } from '../../tests/hook-harness.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

afterEach(() => { vi.restoreAllMocks(); });

describe('@zhin.js/client/ui deprecation (ADR 0063 P2, D14)', () => {
  it('warns once on first use of the deprecated entry', () => {
    createHookEnv().load(file('../renderer/deprecation.ts')).resetDeprecationWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createHookEnv().load(file('./index.ts'));
    createHookEnv().load(file('./index.ts'));
    const deprecations = warn.mock.calls.filter(([message]) => String(message).includes('`@zhin.js/client/ui` is deprecated'));
    expect(deprecations).toHaveLength(1);
    expect(String(deprecations[0]![0])).toContain('@zhin.js/console-ui');
  });

  it('re-exports the moved names unchanged and keeps the zk- components for the deprecation period', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = createHookEnv();
    const ui = env.load(file('./index.ts'));
    const rpc = env.load(file('./rpc.ts'));
    const locale = env.load(file('./locale.ts'));
    const pluginId = env.load(file('./plugin-id.ts'));
    const declarative = env.load(file('../declarative/index.ts'));
    expect(ui.usePluginRpc).toBe(rpc.usePluginRpc);
    expect(ui.usePluginData).toBe(rpc.usePluginData);
    expect(ui.useRpcResource).toBe(rpc.useRpcResource);
    expect(ui.useLocale).toBe(locale.useLocale);
    expect(ui.translate).toBe(locale.translate);
    expect(ui.formatClock).toBe(locale.formatClock);
    expect(ui.detectLocale).toBe(locale.detectLocale);
    expect(ui.resolvePluginId).toBe(pluginId.resolvePluginId);
    expect(ui.DeclarativePageView).toBe(declarative.DeclarativePageView);
    expect(ui.createDeclarativePage).toBe(declarative.createDeclarativePage);
    expect(ui.DataTable).toBe(declarative.DataTable);
    for (const name of ['PluginPage', 'PageHeader', 'Button', 'Select', 'Modal', 'ConfirmButton', 'pluginUiStyles']) expect(ui[name], name).toBeDefined();
  });
});

describe('@zhin.js/client root entry', () => {
  it('exports the data, locale, plugin ID helpers and the declarative renderer (D14)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = await import('../index.js');
    for (const name of [
      'usePluginRpc', 'usePluginData', 'useRpcResource', 'useLocale', 'detectLocale', 'translate', 'formatClock',
      'resolvePluginId', 'resolveSyncPluginId', 'resolveAdapterConsolePluginId',
      'DeclarativePageView', 'createDeclarativePage', 'DataTable', 'DECLARATIVE_PAGE_CAPABILITIES',
      'AdapterConsolePage', 'ADAPTER_CONSOLE_PAGE_CAPABILITIES', 'createCommentReviewPage',
    ]) expect((root as Record<string, unknown>)[name], name).toBeDefined();
    expect(root.ADAPTER_CONSOLE_PAGE_CAPABILITIES.pageChrome).toBe(true);
    expect(root.DECLARATIVE_PAGE_CAPABILITIES.pageChrome).toBe(true);
    // Styles of the old adapter page are gone; the name stays one minor as an empty string.
    expect(root.adapterConsoleStyles).toBe('');
    expect(root.conversationPickerStyles).toBe('');
  });

  it('importing the root entry does not warn about the deprecated subpath', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await import('../index.js');
    expect(warn.mock.calls.some(([message]) => String(message).includes('`@zhin.js/client/ui` is deprecated'))).toBe(false);
  });
});
