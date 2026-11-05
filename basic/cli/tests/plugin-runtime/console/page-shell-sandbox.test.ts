import { describe, expect, it } from 'vitest';
import { renderConsoleIndex, renderPageShell } from '../../../src/plugin-runtime/console/page-renderer.js';

const page = {
  title: 'Chat',
  route: '/sandbox',
  module: '/assets/client/sandbox.js',
  localName: 'sandbox',
  owner: 'root/sandbox' as never,
};

describe('page shell and runtime.sandbox (ADR 0044)', () => {
  it('serves the built-in chat shell only when the owner declares the capability, whatever the page is named', () => {
    expect(renderPageShell(page, { runtimeSandbox: true })).toContain('sandbox-shell');
    expect(renderPageShell({ ...page, localName: 'dev-chat' }, { runtimeSandbox: true })).toContain('sandbox-shell');
  });

  it('serves the page module otherwise, even for a page called sandbox', () => {
    const html = renderPageShell(page);
    expect(html).toContain('/assets/client/sandbox.js');
    expect(html).not.toContain('resolveSandboxWsUrl');
    expect(renderPageShell(page, { runtimeSandbox: false })).toContain('/assets/client/sandbox.js');
  });

  it('includes a token input form and ?token= query bootstrap in the sandbox shell', () => {
    const html = renderPageShell(page, { runtimeSandbox: true });
    expect(html).toContain('id="token-form"');
    expect(html).toContain('id="token-input"');
    expect(html).toContain('id="token-clear"');
    expect(html).toContain("new URLSearchParams(location.search).get('token')");
  });

  it('provides dark theme CSS variables, Tailwind-like utility classes, and shared module bootstrap for standalone pages', () => {
    const html = renderPageShell({
      title: 'Ambient',
      route: '/ambient',
      module: '/assets/client/ambient.js',
      localName: 'ambient',
      owner: 'root/ambient' as never,
    });
    expect(html).toContain('--background: #09090b');
    expect(html).toContain('.bg-card');
    expect(html).toContain('.text-muted-foreground');
    expect(html).toContain('__ZHIN_CONSOLE_SHARED_MODULES__');
    expect(html).toContain('__ZHIN_ACTIVE_PLUGIN_ID__');
    expect(html).toContain('data-zhin-plugin-id');
    expect(html).toContain('BrowserRouter');
    expect(html).toContain('PageErrorBoundary');
    expect(html).toContain('"pluginId":"root/ambient"');
  });

  it('renders the interactive sandbox shell with scene switcher, sender switcher, streaming edit, rich segments, and quick commands', () => {
    const html = renderPageShell(page, { runtimeSandbox: true });
    expect(html).toContain('id="sandbox-fallback"');
    expect(html).toContain('id="channel-name"');
    expect(html).toContain('id="chat-messages"');
    expect(html).toContain('id="chat-form"');
    expect(html).toContain('id="chat-input"');
    expect(html).toContain('id="ws-status"');
    expect(html).toContain('id="scene-switcher"');
    expect(html).toContain('id="sender-switcher"');
    expect(html).toContain('id="quick-commands"');
    expect(html).toContain('data-message-id');
  });

  it('renders grouped cards and token controls in the local Console index', () => {
    const html = renderConsoleIndex([
      {
        title: 'Sandbox',
        route: '/sandbox',
        description: 'Interactive IM simulator',
        group: 'Core',
        owner: 'root/sandbox' as never,
      },
      {
        title: 'Logs',
        route: '/logs',
        description: 'Live logs',
        group: 'Operations',
        owner: 'root/logs' as never,
      },
    ]);
    expect(html).toContain('Core');
    expect(html).toContain('Operations');
    expect(html).toContain('Interactive IM simulator');
    expect(html).toContain('id="token-form"');
    expect(html).toContain('id="token-input"');
    expect(html).toContain('id="token-clear"');
  });
});

