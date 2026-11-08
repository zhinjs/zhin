import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildProjectPreviewSnapshot,
  renderPreviewWorkbenchHtml,
} from '../src/commands/preview.js';

describe('zhin preview command', () => {
  it('discovers and renders components in examples/minimal-bot with default and custom props', async () => {
    const minimalBotRoot = resolve(process.cwd(), 'examples/minimal-bot');
    const snapshot = await buildProjectPreviewSnapshot(minimalBotRoot);

    expect(snapshot.projectName).toBe('minimal-bot');
    expect(snapshot.components.length).toBeGreaterThanOrEqual(1);

    const statusCard = snapshot.components.find((c) => c.name === 'status-card');
    expect(statusCard).toBeDefined();
    expect(statusCard?.error).toBeUndefined();
    expect(statusCard?.html).toContain('服务状态');
    expect(statusCard?.html).toContain('42MB');

    const customSnapshot = await buildProjectPreviewSnapshot(
      minimalBotRoot,
      new Map([
        [
          statusCard!.id,
          {
            title: '自定义调优标题',
            lines: [{ label: '延迟', value: '12ms' }],
          },
        ],
      ]),
    );
    const customCard = customSnapshot.components.find((c) => c.name === 'status-card');
    expect(customCard?.html).toContain('自定义调优标题');
    expect(customCard?.html).toContain('12ms');

    const html = renderPreviewWorkbenchHtml(snapshot, { liveReload: false });
    expect(html).toContain('Zhin 组件与页面预览工作台');
    expect(html).toContain('minimal-bot');
  });

  it('discovers and projects Console page blueprints in examples/full-bot', async () => {
    const fullBotRoot = resolve(process.cwd(), 'examples/full-bot');
    const snapshot = await buildProjectPreviewSnapshot(fullBotRoot);

    expect(snapshot.projectName).toBe('full-bot');
    expect(snapshot.components.some((c) => c.name === 'status-card' && !c.error)).toBe(true);
    expect(snapshot.pages.length).toBeGreaterThanOrEqual(3);

    const indexPage = snapshot.pages.find((p) => p.name === 'index');
    expect(indexPage?.kind).toBe('blueprint');
    expect(indexPage?.imCard?.title).toContain('Full Bot');
    expect(indexPage?.cliPanel).toContain('Full Bot');
  });
});
