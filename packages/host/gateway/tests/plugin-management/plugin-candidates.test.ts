import { officialPluginCandidates, officialPluginCatalog, undeclaredPluginMessage } from '../../src/plugin-management/plugin-candidates.js';

describe('official plugin candidates (#1250)', () => {
  it('maps short names to official packages only', async () => {
    expect(await officialPluginCandidates('reminder')).toEqual(['@zhin.js/plugin-reminder']);
    expect(await officialPluginCandidates('plugin-rss')).toEqual(['@zhin.js/plugin-rss']);
    expect(await officialPluginCandidates('sandbox')).toEqual(['@zhin.js/adapter-sandbox']);
    expect(await officialPluginCandidates('left-pad')).toEqual([]);
    expect(await officialPluginCandidates('')).toEqual([]);
  });

  it('keeps the catalog inside the @zhin.js scope', () => {
    const catalog = officialPluginCatalog();
    expect(catalog.length).toBeGreaterThan(3);
    for (const name of catalog) expect(name.startsWith('@zhin.js/')).toBe(true);
  });

  it('never puts the request into an install command', () => {
    expect(undeclaredPluginMessage('reminder', [])).toBe('找不到插件实例 reminder（配置中没有声明）');
    const message = undeclaredPluginMessage('reminder', ['@zhin.js/plugin-reminder']);
    expect(message).toContain('zhin install @zhin.js/plugin-reminder');
    expect(message).not.toMatch(/zhin install reminder/u);
  });
});
