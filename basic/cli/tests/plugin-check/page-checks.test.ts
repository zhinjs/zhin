import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  checkPageSource,
  checkPluginPageUi,
  classNameRule,
  formatPageUiReport,
  isFixedContentWidth,
  isRawStyleValue,
  listPageSources,
  PAGE_UI_RULES,
} from '../../src/plugin-check/page-checks.js';
import { checkPlugin } from '../../src/plugin-check/index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function pluginWith(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-page-ui-test-'));
  temporaryDirectories.push(directory);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
  return directory;
}

const check = (source: string, file = 'pages/index/index.tsx') => checkPageSource(file, source, ts);
const rulesOf = (source: string, file?: string) => check(source, file).findings.map((finding) => finding.rule);

describe('page UI rules 1–6', () => {
  it('documents six rules, each with a meaning and a replacement', () => {
    expect(PAGE_UI_RULES.map((rule) => rule.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const rule of PAGE_UI_RULES) {
      expect(rule.meaning).not.toBe('');
      expect(rule.fix).toMatch(/console-ui|definePage|主题|组件/u);
    }
  });

  it('rule 1: native <select> in JSX and createElement', () => {
    expect(rulesOf('export default () => <select value="a"><option>a</option></select>;')).toEqual([1]);
    expect(rulesOf("import React from 'react'; export default () => React.createElement('select', null);", 'pages/x/index.ts')).toEqual([1]);
  });

  it('rule 2: <h1>, and PageHeader / PluginPage from @zhin.js/client/ui (not type-only imports)', () => {
    expect(rulesOf('export default () => <h1>标题</h1>;')).toEqual([2]);
    expect(rulesOf("import { PageHeader, Button } from '@zhin.js/client/ui';")).toEqual([2]);
    expect(rulesOf("import { PluginPage as Shell } from '@zhin.js/client/ui';")).toEqual([2]);
    expect(rulesOf("import * as UI from '@zhin.js/client/ui'; export default () => <UI.PageHeader title=\"x\" />;")).toEqual([2]);
    expect(rulesOf("import type { PageHeader } from '@zhin.js/client/ui';")).toEqual([]);
    expect(rulesOf("import { PageHeader } from '@zhin.js/console-ui';")).toEqual([]);
    expect(rulesOf('export default () => <h2>小节</h2>;')).toEqual([]);
  });

  it('rule 3: fixed content width on containers, Tailwind width classes and --console-content-max', () => {
    expect(rulesOf('export default () => <div style={{ maxWidth: 960 }} />;')).toEqual([3]);
    expect(rulesOf("export default () => <div style={{ width: '48rem' }} />;")).toEqual([3]);
    expect(rulesOf('export default () => <div className="mx-auto max-w-4xl" />;')).toEqual([3]);
    expect(rulesOf('export default () => <div className="max-w-[1200px]" />;')).toEqual([3]);
    expect(rulesOf("export default () => <div style={{ '--console-content-max': '80rem' }} />;")).toEqual([3]);
    expect(rulesOf('.page { max-width: 1100px; }', 'pages/index/page.css')).toEqual([3]);
    // Small widths (icons, inputs) and fluid widths are not content widths.
    expect(rulesOf('export default () => <img style={{ width: 16 }} className="w-[120px] max-w-md max-w-full" />;')).toEqual([]);
  });

  it('rule 4: raw style values in style attributes, style objects, CSS-in-JS strings and stylesheets', () => {
    expect(rulesOf('export default () => <div style={{ padding: 12, fontWeight: 600 }} />;')).toEqual([4, 4]);
    expect(rulesOf("const cardStyle = { borderRadius: '8px', nested: { marginTop: 4 } };", 'pages/x/style.ts')).toEqual([4, 4]);
    expect(rulesOf('const css = `.card { gap: 8px; box-shadow: 0 1px 2px #0003; }`;', 'pages/x/styles.ts')).toEqual([4, 4]);
    expect(rulesOf('.card { font-size: 13px; padding: var(--console-card-padding); margin: 0 auto; }', 'pages/x/a.css')).toEqual([4]);
    // Zero, keywords and Console tokens are fine; other variables are not tokens.
    expect(isRawStyleValue('0')).toBe(false);
    expect(isRawStyleValue('var(--console-control-radius)')).toBe(false);
    expect(isRawStyleValue('calc(var(--console-card-padding) * 2)')).toBe(false);
    expect(isRawStyleValue('none')).toBe(false);
    expect(isRawStyleValue('var(--sb-radius-md)')).toBe(true);
    expect(isRawStyleValue('bold')).toBe(true);
    // Non-style objects with the same keys are not checked.
    expect(rulesOf('const options = { padding: 12, gap: 3 };', 'pages/x/index.ts')).toEqual([]);
  });

  it('rule 5: arbitrary values, off-scale spacing keys and default shadows', () => {
    for (const token of ['p-[13px]', 'rounded-[10px]', 'text-[15px]', 'md:gap-2.5', 'p-5', '-mt-10', 'shadow', 'shadow-lg', 'hover:shadow-md']) {
      expect(classNameRule(token), token).toBe(5);
    }
    for (const token of ['p-4', 'gap-3', 'px-0', 'm-auto', 'mx-px', '-mt-2', 'shadow-e1', 'shadow-none', 'p-(--console-card-padding)', 'p-[var(--console-card-padding)]', 'h-11', 'w-[120px]']) {
      expect(classNameRule(token), token).toBeUndefined();
    }
    expect(rulesOf('export default () => <div className="flex gap-5 p-4" />;')).toEqual([5]);
    expect(rulesOf('export default ({ on }) => <div className={`p-4 ${on ? "shadow-lg" : ""}`} />;')).toEqual([5]);
  });

  it('rule 6: native controls in JSX and createElement', () => {
    const source = 'export default () => (<><button /><input /><textarea /><table /><dialog /></>);';
    expect(rulesOf(source)).toEqual([6, 6, 6, 6, 6]);
    expect(rulesOf("h.createElement('button', null);", 'pages/x/index.ts')).toEqual([6]);
    expect(rulesOf('export default () => <Button />;')).toEqual([]);
  });

  it('ignores imports, comments and words in prose', () => {
    expect(rulesOf("import './p-5.css';\n// <select> 和 p-5 只是注释\nexport const text = 'Use a select box';")).toEqual([]);
  });
});

describe('inline ignore comments', () => {
  it('waives the named rule on the next code line, or on its own line when trailing', () => {
    const result = check([
      'export default () => (',
      '  <div>',
      '    {/* zhin-ui-ignore 6: 画布内的原生 <button>，焦点和触控尺寸已自行满足底线 */}',
      '    <button />',
      '    <input /> {/* zhin-ui-ignore 6: 文件选择器 */}',
      '    <textarea />',
      '  </div>',
      ');',
    ].join('\n'));
    expect(result.findings.map((finding) => [finding.rule, finding.line])).toEqual([[6, 6]]);
    expect(result.exemptions.map((exemption) => [exemption.rules, exemption.target, exemption.reason])).toEqual([
      [[6], 4, '画布内的原生 <button>，焦点和触控尺寸已自行满足底线'],
      [[6], 5, '文件选择器'],
    ]);
    expect(result.directiveProblems).toEqual([]);
  });

  it('waives only the named rules', () => {
    const result = check([
      '// zhin-ui-ignore 4: 画布坐标需要像素',
      'export default () => <div className="p-5" style={{ padding: 3 }} />;',
    ].join('\n'));
    expect(result.findings.map((finding) => finding.rule)).toEqual([5]);
    expect(check('// zhin-ui-ignore 4,5: 画布\nexport default () => <div className="p-5" style={{ padding: 3 }} />;').findings).toEqual([]);
  });

  it('works in stylesheets', () => {
    const result = check('.canvas {\n  /* zhin-ui-ignore 4: 画布网格对齐像素 */\n  gap: 7px;\n}', 'pages/x/a.css');
    expect(result.findings).toEqual([]);
    expect(result.exemptions).toHaveLength(1);
  });

  it('reports comments without a rule, with an unknown rule, without a reason, or that waive nothing', () => {
    const problems = (source: string) => check(source).directiveProblems.map((problem) => problem.message);
    expect(problems('// zhin-ui-ignore\nexport default () => <button />;')[0]).toMatch(/写法应为/u);
    expect(problems('// zhin-ui-ignore 7: x\nexport default () => <button />;')[0]).toMatch(/第 1–6 条/u);
    expect(problems('// zhin-ui-ignore 6:\nexport default () => <button />;')[0]).toMatch(/缺少理由/u);
    expect(problems('// zhin-ui-ignore 1: 旧注释\nexport default () => <button />;')[0]).toMatch(/没有豁免任何违规/u);
    // A malformed comment waives nothing.
    expect(check('// zhin-ui-ignore 6\nexport default () => <button />;').findings).toHaveLength(1);
  });

  it('collects Playwright audit exemptions written as data-zhin-ui-ignore', () => {
    const result = check('export default () => <canvas data-zhin-ui-ignore="touch-target: 画布内的点击由画布自己处理" />;');
    expect(result.auditExemptions).toEqual([
      { check: 'touch-target', reason: '画布内的点击由画布自己处理', file: 'pages/index/index.tsx', line: 1 },
    ]);
    expect(check('export default () => <div data-zhin-ui-ignore="touch-target" />;').directiveProblems).toHaveLength(1);
  });
});

describe('plugin page scan', () => {
  it('scans pages/** sources and stylesheets, skipping tests, declarations and generated .js siblings', () => {
    const directory = pluginWith({
      'pages/index/index.tsx': 'export default () => <select />;',
      'pages/index/index.js': 'export default () => null;',
      'pages/index/view.test.tsx': 'export default () => <select />;',
      'pages/index/types.d.ts': 'export {};',
      'pages/index/page.css': '.a { padding: 3px; }',
      'pages/index/logo.svg': '<svg />',
      'src/index.tsx': 'export default () => <select />;',
    });
    expect(listPageSources(directory)).toEqual(['pages/index/index.tsx', 'pages/index/page.css']);
    const report = checkPluginPageUi(directory);
    expect(report.findings.map((finding) => `${finding.rule}@${finding.file}`)).toEqual([
      '1@pages/index/index.tsx',
      '4@pages/index/page.css',
    ]);
    const lines = formatPageUiReport(report).join('\n');
    expect(lines).toContain('只提示');
    expect(lines).toContain('Select');
    expect(lines).toContain('zhin-ui-ignore');
  });

  it('keeps page UI findings out of errors and warnings for third-party plugins', async () => {
    const directory = pluginWith({
      'package.json': JSON.stringify({ name: 'zhin.js-demo' }),
      'pages/index/index.tsx': 'export default () => <><select /><button /></>;',
    });
    const report = await checkPlugin(directory, { pack: false });
    expect(report.hintCount).toBe(2);
    expect(report.ui?.findings).toHaveLength(2);
    const all = [...report.source.errors, ...report.source.warnings].join('\n');
    expect(all).not.toMatch(/select|button/u);
  });

  it('omits the UI section for plugins without pages', async () => {
    const report = await checkPlugin(pluginWith({ 'package.json': JSON.stringify({ name: 'zhin.js-demo' }) }), { pack: false });
    expect(report.ui).toBeUndefined();
    expect(report.hintCount).toBe(0);
  });

  it('reports width thresholds as documented', () => {
    expect(isFixedContentWidth('640px')).toBe(true);
    expect(isFixedContentWidth('639px')).toBe(false);
    expect(isFixedContentWidth('min(100%, 60rem)')).toBe(true);
    expect(isFixedContentWidth('100%')).toBe(false);
  });
});
