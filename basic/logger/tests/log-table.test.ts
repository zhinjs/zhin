import { describe, expect, it } from 'vitest';
import { formatLogTable, buildLogTableTotalsRow, formatLogKvTable } from '../src/log-table.js';
import { formatLogPanel } from '../src/log-panel.js';
import { wrapDisplayText, displayWidth } from '../src/terminal-width.js';

describe('formatLogTable', () => {
  it('renders boxed table with borders', () => {
    const text = formatLogTable(
      [
        { key: 'plugin', header: '插件' },
        { key: 'cmd', header: '命令', align: 'right' },
      ],
      [{ plugin: 'demo', cmd: 3 }],
      { style: 'box', title: '测试' },
    );
    expect(text).toContain('╭');
    expect(text).toContain('╯');
    expect(text).toContain('│');
    expect(text).toContain('测试');
    expect(text).toContain('demo');
  });

  it('renders empty placeholder', () => {
    expect(formatLogTable([], [])).toContain('empty');
  });

  it('renders totals row with vertical bars not branch', () => {
    const columns = [
      { key: 'plugin', header: '插件' },
      { key: 'cmd', header: '命令', align: 'right' as const },
    ];
    const rows = [{ plugin: 'a', cmd: 2 }];
    const totals = buildLogTableTotalsRow(columns, rows);
    const text = formatLogTable(columns, rows, { totalsRow: totals });
    const lines = text.split('\n');
    const totalsLine = lines.find((l) => l.includes('合计'));
    expect(totalsLine).toBeDefined();
    expect(totalsLine!.replace(/\x1b\[[0-9;]*m/g, '')).toMatch(/^│/);
    expect(totalsLine!.replace(/\x1b\[[0-9;]*m/g, '')).not.toMatch(/^├/);
  });
  it('builds totals row', () => {
    const columns = [
      { key: 'plugin', header: '插件' },
      { key: 'cmd', header: '命令', align: 'right' as const },
    ];
    const rows = [{ plugin: 'a', cmd: 2 }, { plugin: 'b', cmd: 3 }];
    const totals = buildLogTableTotalsRow(columns, rows);
    expect(totals.cmd).toBe(5);
  });
});

describe('formatLogKvTable', () => {
  it('renders key-value rows without header', () => {
    const text = formatLogKvTable(
      [{ label: '配置', value: 'zhin.config.yml' }],
      { title: 'Ready' },
    );
    expect(text).toContain('Ready');
    expect(text).toContain('配置');
    expect(text).toContain('zhin.config.yml');
    expect(text).toContain('╭');
    expect(text).toContain('╯');
    // 无表头分隔行（hideHeader）
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    const midCount = (plain.match(/├/g) ?? []).length;
    expect(midCount).toBe(0);
  });

  it('inserts section breaks between row groups', () => {
    const text = formatLogKvTable(
      [
        { label: '配置', value: 'a.yml' },
        { label: '数据库', value: 'sqlite' },
      ],
      { sectionBreaks: [0] },
    );
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toContain('├');
  });

  it('keeps right border aligned with emoji and CJK wrapped values', () => {
    const output =
      '我能做的事情挺多的，简单列几个： **日常工具** - 📅 **签到积分** — 查询积分、排行榜、连签天数 - 🔍 **Web 搜索** — 搜索公开信息 - 📊 **群消息分析** — 统计群消息、参与人数、活跃时段';
    const valueWidth = 54;
    const wrapped = wrapDisplayText(output, valueWidth);
    const rows = [
      { label: '耗时', value: '8710 ms' },
      { label: 'Token', value: '5317 (In 5002 / Out 315)' },
      { label: '模式', value: 'mode: agent · iter: 1 · model: mimo-v2.5-free' },
      { label: '用户输入', value: '你能做什么' },
      { label: '思考', value: '·' },
      ...wrapped.map((line, index) => ({
        label: index === 0 ? '输出' : '',
        value: line,
      })),
    ];
    const text = formatLogKvTable(rows, {
      title: 'AI Handler · 8710 ms',
      sectionBreaks: [2, 4],
      maxValueWidth: valueWidth,
    });
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    const bodyRows = plain.split('\n').filter((line) => line.startsWith('│') && line.endsWith('│'));
    const visualWidths = bodyRows.map((line) => displayWidth(line));
    expect(bodyRows.length).toBeGreaterThan(3);
    expect(new Set(visualWidths).size).toBe(1);
  });
});

describe('formatLogPanel', () => {
  it('renders titled panel', () => {
    const text = formatLogPanel('Ready', [{ label: 'PID', value: '123' }]);
    expect(text).toContain('Ready');
    expect(text).toContain('PID');
    expect(text).toContain('123');
  });

  it('skips header when title empty', () => {
    const text = formatLogPanel('', [{ label: 'A', value: '1' }]);
    expect(text).not.toContain('═');
    expect(text).toContain('A');
  });
});
