import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { htmlRenderScale } from '../pages/index/HtmlMessage.js';
import { renderSandboxSegment, renderSandboxSegments, type SandboxSegmentRenderContext } from '../pages/index/segments/index.js';
import { sandboxStyles } from '../pages/index/styles.js';
import { workspaceStyles } from '../pages/index/workspaceStyles.js';

(globalThis as { React?: typeof React }).React = React;

/**
 * #1250 `command-menu-unreadable-in-sandbox` (retest comment 6912181348): a 1080px command menu
 * was measured against its own frame, so its scale stayed 1 and the page grew wider. This lays the
 * real message markup and stylesheets out in Chromium and checks what `HtmlMessage` measures.
 */
const require = createRequire(import.meta.url);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
let chromium: typeof import('@playwright/test').chromium | undefined;
try {
  ({ chromium } = require('@playwright/test') as typeof import('@playwright/test'));
} catch { /* resolved below */ }
const browserAvailable = Boolean(chromium && (executablePath ? existsSync(executablePath) : existsSync(chromium.executablePath())));

const consoleUiStyles = (() => {
  try {
    return readFileSync(require.resolve('@zhin.js/console-ui/styles.css'), 'utf8');
  } catch {
    return '';
  }
})();

const context = (): SandboxSegmentRenderContext => ({
  locale: 'zh-CN', isSent: false, interactionResolved: false, canInteract: true,
  sendAction: () => true, renderNested: (segments) => renderSandboxSegments(segments, context()),
});

/**
 * The page's real shape: a sidebar and a `1fr` message pane whose width comes from the viewport. A
 * frame that takes part in layout raises the pane's min-content width and widens the whole page.
 */
const SIDEBAR = 232;
/** The message column width of the retest (#1250 comment 6912181348). */
const COLUMN = 600;
function messagePage(): string {
  const segment = renderToStaticMarkup(React.createElement(React.Fragment, null, renderSandboxSegment(
    { type: 'html', data: { html: '<main style="height:600px">menu</main>', width: 1080 } }, context(), 0)));
  return `<!doctype html><html><head><style>${consoleUiStyles}</style><style>${sandboxStyles}${workspaceStyles}</style></head>
<body style="margin:0"><div style="display:flex"><div class="console-page" style="flex:1 1 auto">
<section class="zhin-sandbox agent-playground-shell">
<nav class="channel-sidebar agent-playground-sessions">sessions</nav><main class="chat-area agent-playground-main">
<section class="agent-playground-conversation"><div class="agent-playground-message-scroll"><div class="agent-playground-message-list" style="width:${COLUMN}px">
<article class="agent-playground-message is-agent"><span class="agent-playground-message-avatar">B</span>
<div class="agent-playground-message-main"><div class="agent-playground-message-meta"><strong>Bot</strong></div>
<div class="agent-playground-message-content">${segment}</div></div></article></div></div></section></main></section></div></div></body></html>`;
}

describe.skipIf(!browserAvailable)('Sandbox HTML card scaling in a real layout (#1250 command-menu-unreadable-in-sandbox)', () => {
  it('scales a 1080px menu to a 600px message column without widening the page', async () => {
    const browser = await chromium!.launch(executablePath ? { executablePath } : {});
    try {
      const viewport = 1280;
      const page = await browser.newPage({ viewport: { width: viewport, height: 900 } });
      await page.setContent(messagePage());
      const layout = await page.evaluate(() => ({
        // What HtmlMessage's ResizeObserver measures.
        available: document.querySelector('.sandbox-html-scaled')!.getBoundingClientRect().width,
        bubble: document.querySelector('.agent-playground-message-main')!.getBoundingClientRect().width,
        list: document.querySelector('.agent-playground-message-list')!.getBoundingClientRect().width,
        scroll: document.querySelector('.agent-playground-message-scroll')!.getBoundingClientRect().width,
        page: document.documentElement.scrollWidth,
      }));
      expect(layout.list).toBe(COLUMN);
      // The box takes the bubble's width, which takes the column's (minus the avatar), never the 1080px design.
      expect(layout.bubble).toBeGreaterThan(COLUMN - 60);
      expect(layout.available).toBeGreaterThan(COLUMN - 100);
      expect(layout.available).toBeLessThanOrEqual(COLUMN);
      const scale = htmlRenderScale(1080, layout.available);
      expect(scale).toBeGreaterThan(0.45);
      expect(scale).toBeLessThanOrEqual(0.56);
      expect(layout.page).toBe(viewport);

      // The 1080px frame takes no part in intrinsic sizing: a host that sizes the conversation by its
      // content (a flex / grid / fit-content ancestor) is not widened by the design width.
      const intrinsic = await page.evaluate(() => {
        const bubble = document.querySelector<HTMLElement>('.agent-playground-message-content')!;
        const probe = (value: string) => { bubble.style.width = value; const width = bubble.getBoundingClientRect().width; bubble.style.width = ''; return width; };
        return { minContent: probe('min-content'), maxContent: probe('max-content') };
      });
      expect(intrinsic.minContent).toBeLessThan(200);
      expect(intrinsic.maxContent).toBeLessThan(200);

      // Applying the scale (as the component does) keeps the page width and sizes the box to the scaled height.
      const scaled = await page.evaluate((value) => {
        const box = document.querySelector<HTMLElement>('.sandbox-html-scaled')!;
        const frame = box.querySelector<HTMLElement>('iframe')!;
        frame.style.height = '600px';
        frame.style.transform = `scale(${value})`;
        box.style.height = `${Math.ceil(600 * value)}px`;
        return {
          page: document.documentElement.scrollWidth,
          box: box.getBoundingClientRect().height,
          frame: frame.getBoundingClientRect().width,
          available: box.getBoundingClientRect().width,
        };
      }, scale);
      expect(scaled.page).toBe(viewport);
      expect(scaled.box).toBe(Math.ceil(600 * scale));
      expect(scaled.frame).toBeCloseTo(1080 * scale, 0);
      expect(scaled.available).toBe(layout.available);
    } finally {
      await browser.close();
    }
  }, 30_000);
});
