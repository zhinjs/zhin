import { describe, expect, it } from 'vitest';
import { renderPageShell } from '../../../src/plugin-runtime/console/page-renderer.js';

const page = { title: 'Chat', route: '/sandbox', module: '/assets/client/sandbox.js', localName: 'sandbox' };

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
    expect(html).toContain("new URLSearchParams(location.search).get('token')");
  });
});
