import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildProjectPreviewSnapshot,
  createPreviewContext,
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

  // #1250 `preview-context-missing-use`: components that read plugin services rendered with
  // `context.use is not a function`. The preview context now has `use` / `has`, served by the
  // component's `previewServices`, and names a token without a stand-in.
  it('gives the render context use()/has() from previewServices and names a token without a stand-in', async () => {
    const context = createPreviewContext({ previewServices: [{ token: { id: 'demo.weather', description: '天气服务' }, value: { today: () => '晴' } }] }) as {
      has(token: { id: string }): boolean;
      use(token: { id: string; description?: string }): unknown;
    };
    expect(context.has({ id: 'demo.weather' })).toBe(true);
    expect((context.use({ id: 'demo.weather' }) as { today(): string }).today()).toBe('晴');
    expect(context.has({ id: 'demo.database' })).toBe(false);
    expect(() => context.use({ id: 'demo.database', description: '数据库' }))
      .toThrow('预览环境没有提供 数据库（demo.database），可在组件的 previewServices 里给一个替身');

    // End to end: a project component (resolving zhin.js from examples/minimal-bot) that calls use().
    const project = await mkdtemp(join(resolve(process.cwd(), 'examples/minimal-bot'), '.tmp-preview-services-'));
    try {
      await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'preview-services-fixture', type: 'module' }));
      for (const [name, services] of [['with-stub', 'previewServices: [{ token: weather, value: { today: () => \'晴\' } }],'], ['without-stub', '']]) {
        await mkdir(join(project, 'components', name), { recursive: true });
        await writeFile(join(project, 'components', name, 'index.ts'), [
          "import { createToken } from 'zhin.js';",
          "import { defineComponent } from 'zhin.js/component';",
          "const weather = createToken<{ today(): string }>('demo.weather', '天气服务');",
          'export default defineComponent({',
          `  ${services}`,
          "  render: (_props, { use }) => `今天${use(weather).today()}`,",
          '});',
        ].join('\n'));
      }
      const snapshot = await buildProjectPreviewSnapshot(project);
      const withStub = snapshot.components.find(component => component.name === 'with-stub');
      expect(withStub?.error).toBeUndefined();
      expect(withStub?.html).toContain('今天晴');
      expect(snapshot.components.find(component => component.name === 'without-stub')?.error)
        .toBe('预览环境没有提供 天气服务（demo.weather），可在组件的 previewServices 里给一个替身');
    } finally { await rm(project, { recursive: true, force: true }); }
  });
});
