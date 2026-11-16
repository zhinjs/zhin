import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildAgentSurfaceInfoReport,
  formatAgentSurfaceInfoReport,
} from '../../src/discovery/agent-surface-info.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function touch(file: string, content = ''): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

describe('agent-surface-info', () => {
  it('discovers plugin utils/lottery agent surface from monorepo', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const report = await buildAgentSurfaceInfoReport(repoRoot);
    const lottery = report.plugins.find((p) => p.pluginName.includes('lottery'));
    expect(lottery).toBeDefined();
    expect(lottery!.tools).toContain('lottery_skill_lottery_history');
    expect(new Set(lottery!.tools).size).toBe(lottery!.tools.length);
    const text = formatAgentSurfaceInfoReport(report);
    expect(text).toContain('合计：');
  });

  it('counts the project root, local and installed plugins, grouped by source (#1250 agent-info-misses-root-capabilities)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhin-agent-info-'));
    directories.push(root);
    await touch(path.join(root, 'package.json'), JSON.stringify({ name: 'my-bot' }));
    await touch(path.join(root, 'tools', 'weather', 'index.ts'));
    await touch(path.join(root, 'tools', 'news', 'index.ts'));
    await touch(path.join(root, 'skills', 'travel', 'SKILL.md'));
    await touch(path.join(root, 'agents', 'helper', 'agent.json'), '{}');
    await touch(path.join(root, 'agents', 'helper', 'tools', 'lookup', 'index.ts'));
    await touch(path.join(root, 'plugins', 'music', 'package.json'), JSON.stringify({ name: 'music' }));
    await touch(path.join(root, 'plugins', 'music', 'tools', 'play', 'index.ts'));
    await touch(path.join(root, 'node_modules', '@zhin.js', 'plugin-lottery', 'package.json'), JSON.stringify({ name: '@zhin.js/plugin-lottery', zhin: { type: 'plugin' } }));
    await touch(path.join(root, 'node_modules', '@zhin.js', 'plugin-lottery', 'skills', 'draw', 'SKILL.md'));
    // Not a zhin package: its `tools/` directory is no plugin.
    await touch(path.join(root, 'node_modules', 'random-lib', 'package.json'), JSON.stringify({ name: 'random-lib' }));
    await touch(path.join(root, 'node_modules', 'random-lib', 'tools', 'build', 'index.ts'));

    const report = await buildAgentSurfaceInfoReport(root);
    expect(report.plugins.map((p) => [p.source, p.pluginName])).toEqual([['project', 'my-bot'], ['local', 'music'], ['installed', 'lottery']]);
    expect(report.plugins[0]!.tools).toEqual(expect.arrayContaining(['my-bot_news', 'my-bot_weather', 'my-bot_agent_helper_lookup']));
    expect(report.totals).toMatchObject({ plugins: 3, tools: 4, skills: 2, workspaceAgents: 1 });
    expect(report.bySource).toMatchObject({ project: { tools: 3, skills: 1 }, local: { tools: 1 }, installed: { skills: 1 } });

    const zh = formatAgentSurfaceInfoReport(report);
    expect(zh).toContain('合计：3 个来源包、4 个工具、2 个技能、1 个工作区 Agent');
    expect(zh).toContain('  项目根目录：1 个包、3 个工具、1 个技能');
    expect(zh).toContain('[已安装的插件（node_modules）]');
    const en = formatAgentSurfaceInfoReport(report, 'en');
    expect(en).toContain('Totals: 3 package(s), 4 tool(s), 2 skill(s), 1 workspace agent(s)');
    expect(en).toContain('[Project root]');
  });
});
