// Run after building @zhin.js/jsx and @zhin.js/components:
// node packages/toolkit/components/examples/gallery.mjs [output.html]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { jsx, rawHtml, renderToHtml } from '@zhin.js/jsx';
import {
  ThemeProvider, CardCanvas, Card, CardHeader, Surface, Section, Row, Col,
  Divider, KvTable, MetricBlock, StatChip, Badge, UsageBar, BarChart,
  RadarChart, Sparkline, TopicItem, ProfileRow, QuoteCard, EmptyState,
  Table, TableRow, TableCell, Checkbox, Radio, Switch, Button,
  List, ListItem, Markdown, CodeBlock,
} from '../lib/index.js';

let tw;
try {
  const { createTailwindStyle } = await import('@zhin.js/tailwind');
  tw = await createTailwindStyle({ theme: { '--color-brand': '#2563eb' } });
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('@zhin.js/tailwind')) throw error;
}

const output = resolve(process.argv.slice(2).find(argument => argument !== '--')
  ?? join(tmpdir(), 'zhin-jsx-visual', 'gallery.html'));
const node = (component, props = {}, children) => jsx(component, {
  ...props, ...(children === undefined ? {} : { children }),
});
const badge = (text, props) => node(Badge, props, text);
const section = (id, title, children) => node('section', { 'data-gallery-section': id },
  node(Section, { title }, node(Col, { gap: 0 }, children)));

function tableExamples() {
  const cells = (values, header = false) => values.map((value, index) => node(TableCell, {
    header, width: index === 0 ? '45%' : undefined,
    align: index === 2 ? 'right' : 'left',
  }, value));
  return [
    node(Table, {
      caption: '数据表 · headers / rows',
      headers: ['服务', '状态', '请求数'],
      rows: [
        ['Gateway', badge('在线', { accent: '#10b981' }), '1,280'],
        ['Worker', badge('等待', { accent: '#f59e0b' }), '84'],
      ],
    }),
    node(Table, { caption: '组合表格 · 单元格嵌套组件与对齐' }, [
      node(TableRow, { header: true, separator: false }, cells(['负责人 / 项目', '进度', '操作'], true)),
      node(TableRow, {}, cells([
        node(Col, { gap: 8 }, [
          badge('PM · 归雨'),
          node(Row, { gap: 8, wrap: true }, [badge('需求'), badge('设计')]),
        ]),
        node(Col, { gap: 8 }, [badge('进行中'), node(UsageBar, { percent: 68 })]),
        node(Button, { variant: 'secondary', size: 'sm' }, '查看'),
      ])),
      node(TableRow, {}, cells([
        node(Col, { gap: 8 }, [badge('QA · 林'), badge('验收')]),
        node(Checkbox, { checked: true, disabled: true, label: '完成' }),
        node(Button, { variant: 'primary', size: 'sm' }, '报告'),
      ])),
    ]),
    node(Table, {
      caption: '无表头 · 局部样式覆盖',
      rows: [['Build', '通过'], ['Deploy', '等待审批']],
      custom: { style: { borderRadius: 4, borderColor: '#8b5cf6' } },
    }),
  ];
}

function layoutExamples() {
  const tile = text => node(Surface, {
    padding: '8px 12px', custom: { style: { flex: 1 } },
  }, badge(text));
  return node(Col, { gap: 16 }, [
    node(Row, { gap: 16, align: 'center' }, [tile('横向 A'), tile('横向 B'), tile('横向 C')]),
    node(Col, { gap: 16 }, [tile('纵向 A'), tile('纵向 B')]),
    node(Row, { gap: 16, wrap: true }, [
      node(StatChip, { label: '事件', value: 1280 }),
      node(StatChip, { label: '活跃', value: 24 }),
      node(StatChip, { label: '成功率', value: '99.9%' }),
    ]),
  ]);
}

function listExamples() {
  return [
    node(List, {}, [
      node(ListItem, {}, node(Row, { gap: 8, align: 'center' }, [badge('需求'), '梳理实际使用场景'])),
      node(ListItem, {}, node(Col, { gap: 8 }, [
        node('strong', {}, '嵌套 JSX 列表'),
        node(List, { items: [node('em', {}, '同步和异步结果保持统一'), badge('组件样式随主题继承')] }),
      ])),
      node(ListItem, { marker: badge('✓') }, '自定义 marker'),
    ]),
    node(List, { ordered: true, start: 3, items: ['架构评审', node('b', {}, '真实链路验证'), '发版检查'] }),
  ];
}

function markdownExamples() {
  const source = [
    '### 发布验收',
    '用 **统一结果链** 保持可读性，支持 _重点_、~~旧方案~~ 与 `segment.html`。',
    '',
    '> 文档、代码和真实输出应保持一致。',
    '',
    '- [x] JSX 组件渲染',
    '- [ ] 平台验收',
    '  - 私聊和群聊',
    '  - HTML 与图片降级',
    '',
    '| 环节 | 状态 |',
    '| --- | --- |',
    '| 类型 | 通过 |',
    '| 视觉 | 检查中 |',
    '',
    '```typescript',
    'const result = <Card title="服务状态" />;',
    'return result;',
    '```',
    '',
    '[静态链接示例](https://example.invalid/docs)',
  ].join('\n');
  return [
    node(Markdown, { source }),
    node(Markdown, { source: [
      '**安全边界：** 原始 HTML 显示为文字，不执行。',
      '',
      '<untrusted-widget data-mode="preview">HTML 作为文字</untrusted-widget>',
      '',
      '[不安全的协议](javascript:alert(1))',
    ].join('\n') }),
  ];
}

function codeExamples() {
  return [
    node(CodeBlock, {
      language: 'typescript', title: Promise.resolve(node('b', {}, 'status.ts · 异步 JSX 标题')),
      source: [
        'type Status = "ready" | "pending";',
        'const status: Status = "ready";',
        '',
        'if (status === "ready") {',
        '  console.log("任务已通过验收，可以进入发布审批。");',
        '}',
      ].join('\n'),
    }),
    node(CodeBlock, {
      language: 'javascript', title: '长行自动换行',
      source: 'const description = "这是一段会在窄卡片中自动换行的代码，语法颜色、原始空格和完整内容仍然保留，便于阅读与验收。";',
    }),
    node(CodeBlock, {
      language: 'custom-language', title: '未知语言 · 纯文本降级 · 无行号', lineNumbers: false,
      source: '<code> & escaped\n\tindented  text',
    }),
    node(CodeBlock, {
      language: 'json', title: '局部视觉覆盖',
      source: '{\n  "approved": true,\n  "target": "production"\n}',
      custom: { style: { background: '#182135', color: '#fef3c7', borderRadius: 6 } },
    }),
  ];
}

function controlExamples() {
  const states = [
    { title: '未选中', checked: false, disabled: false },
    { title: '已选中', checked: true, disabled: false },
    { title: '禁用 / 未选中', checked: false, disabled: true },
    { title: '禁用 / 已选中', checked: true, disabled: true },
  ];
  return [
    ...states.map(({ title, checked, disabled }) => node(Col, { gap: 8,
      custom: { style: { margin: '8px 0' } },
    }, [
      badge(title),
      node(Row, { gap: 16, wrap: true, align: 'center' }, [
        node(Checkbox, { checked, disabled, label: '复选框' }),
        node(Radio, { checked, disabled, label: '单选框' }),
        node(Switch, { checked, disabled, label: '开关' }),
      ]),
    ])),
    node(Row, { gap: 16, wrap: true, align: 'center' }, [
      node(Checkbox, { checked: true, label: node('strong', {}, 'JSX 标签'), accent: '#8b5cf6' }),
      node(Switch, { checked: true, label: null, accent: '#ec4899' }),
      node(Radio, { checked: true, label: '局部覆盖',
        custom: { style: { color: '#d97706' }, text: { label: '覆盖后的文案' } },
      }),
    ]),
  ];
}

function buttonExamples() {
  return [
    ...['primary', 'secondary', 'danger'].map(variant => node(Row, {
      gap: 12, wrap: true, align: 'center', custom: { style: { margin: '8px 0' } },
    }, [
      ...['sm', 'md', 'lg'].map(size => node(Button, { variant, size }, `${variant} · ${size}`)),
      node(Button, { variant, disabled: true }, '禁用'),
    ])),
    node(Row, { gap: 12, wrap: true }, [
      node(Button, { accent: '#8b5cf6' }, '自定义色'),
      node(Button, { variant: 'secondary', label: node(Row, { gap: 8, align: 'center' }, [
        badge('✓'), 'JSX 内容',
      ]) }),
      node(Button, { variant: 'secondary', custom: {
        style: { borderRadius: 18, borderColor: '#ec4899' }, text: { label: '局部样式与文案' },
      } }),
    ]),
  ];
}

function themeCard(name, theme, description) {
  return node(ThemeProvider, { theme }, node(CardCanvas, { width: 540 }, node(Card, {}, [
    node(CardHeader, {
      title: name, subtitle: description, badge: badge('真实 JSX'),
    }),
    section('table', 'Table / TableRow / TableCell', tableExamples()),
    section('layout', 'Row / Col · 明确 gap 与默认语义间距', layoutExamples()),
    section('lists', 'List / ListItem · 嵌套 JSX 与起始编号', listExamples()),
    section('markdown', 'Markdown · GFM 与安全边界', markdownExamples()),
    section('code', 'CodeBlock · 高亮、行号与长行阅读', codeExamples()),
    section('controls', 'Checkbox / Radio / Switch · 展示状态', controlExamples()),
    section('buttons', 'Button · variant / size / disabled', buttonExamples()),
    section('metrics', '数值与图表', [
      node(KvTable, { rows: [{ label: '环境', value: badge('Production') }, { label: '版本', value: '1.1.x' }] }),
      node(MetricBlock, { label: 'CPU', value: '8 / 16 cores', percent: 68 }),
      node(MetricBlock, { label: '内存', value: '12.4 GB', percent: 42, accent: '#8b5cf6' }),
      node(BarChart, { values: [2, 7, 5, 12, 9, 4], peakIndex: 3, tickLabels: ['08:00', '12:00', '16:00'] }),
      node(Row, { gap: 24, wrap: true, align: 'center' }, [
        node(RadarChart, { labels: ['稳定', '速度', '覆盖', '可读', '扩展'], values: [85, 72, 92, 65, 88], max: 100, size: 180 }),
        node(Sparkline, { values: [2, 5, 3, 8, 6, 12, 9], width: 140, height: 44 }),
      ]),
    ]),
    section('spacing', '默认间距 · QuoteCard → EmptyState', [
      node(TopicItem, { index: 1, title: '产品工作流', summary: '组件保持默认语义间距；容器不重复添加 gap。' }),
      node(ProfileRow, { name: '归雨', badge: badge('PM'), reason: '需求与验收协调' }),
      node(QuoteCard, { content: '发布之前，先把交付物和验收依据对齐。', author: '归雨', reason: '需求讨论' }),
      node(EmptyState, {}),
    ]),
    ...(tw ? [section('tailwind', 'Tailwind · 原生样式与组件局部覆盖', [
      node(Surface, { custom: { style: tw('p-4 rounded-xl bg-brand text-white') } },
        node('div', { style: tw('grid grid-cols-2 gap-4') }, [
          node('div', { style: tw('text-xl font-bold') }, '统一内联样式'),
          node('div', { style: tw('text-sm leading-relaxed') }, '官方工具类 · 可组合主题'),
        ])),
      node('div', { style: tw('p-4 rounded-xl bg-[linear-gradient(135deg,#eef2ff,#e0f2fe)] text-slate-800 shadow-md') }, '渐变、间距、圆角与阴影，无需 CSS 文件'),
    ])] : []),
    section('local', '局部 custom 与嵌套 ThemeProvider', [
      node(ThemeProvider, { theme: { palette: {
        text: '#713f12', textSecondary: '#92400e', textMuted: '#a16207',
        surface: '#fffbeb', border: '#fcd34d',
      } } },
        node(Surface, { padding: '12px 16px' }, node(KvTable, {
          rows: [{ label: '局部作用域', value: badge('Amber') }, { label: '上层主题', value: '其余配置继承' }],
        }))),
      node(Badge, { custom: { style: { borderRadius: 4, color: '#ec4899' }, text: { text: 'custom.text 替换文案' } } }, '原始文案'),
      node(Divider, { margin: '12px 0' }),
      node(EmptyState, { custom: { text: { message: '仅此组件：暂无待办' }, style: { borderRadius: 4 } } }),
    ]),
  ])));
}

const dark = {
  palette: {
    canvas: '#101827', card: '#172033', surface: '#223047',
    text: '#f1f5f9', textSecondary: '#cbd5e1', textMuted: '#94a3b8',
    border: '#334155', divider: '#334155', barTrack: '#334155',
    shadowFloor: 'rgba(0,0,0,0.2)',
  },
  code: { theme: 'github-dark' },
};
const project = {
  palette: { canvas: '#ede9fe', accentMem: '#7c3aed', accentRank: '#7c3aed', textMuted: '#64748b' },
  typography: { fontFamily: 'system-ui, sans-serif', sizes: { body: 13, small: 12 } },
  spacing: { scale: 1.1 },
  radii: { card: 12, surface: 8 },
  components: {
    Button: { borderRadius: 6 },
    Table: { borderRadius: 8 },
    Badge: { fontWeight: 700 },
  },
};
const stylesheet = `
* { box-sizing: border-box; }
body { margin: 0; padding: 32px; background: #e9edf2; color: #172033; font-family: system-ui, sans-serif; }
header { max-width: 1668px; margin: 0 auto 24px; }
h1 { margin: 0 0 12px; font-size: 28px; }
header p { margin: 8px 0; line-height: 1.6; }
.gallery { display: grid; grid-template-columns: repeat(auto-fit, 540px); gap: 24px; justify-content: center; max-width: 1696px; margin: auto; align-items: start; }
.theme-label { margin: 0 0 8px; font-size: 16px; }
@media (max-width: 604px) { body { padding: 16px; } .gallery { grid-template-columns: minmax(0, 1fr); } .gallery article { overflow-x: auto; } }
`;
const html = await renderToHtml(node('html', { lang: 'zh-CN' }, [
  node('head', {}, [
    node('meta', { charset: 'utf-8' }),
    node('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    node('title', {}, 'Zhin JSX 组件预览画廊'),
    node('style', {}, rawHtml(stylesheet)),
  ]),
  node('body', {}, [
    node('header', {}, [
      node('h1', {}, 'Zhin JSX 组件预览画廊'),
      node('p', {}, '全部示例由 @zhin.js/components 的真实组件与统一 JSX serializer 生成。'),
      node('p', {}, '展示能力说明：这些控件用于 HTML 展示或截图，不处理点击、输入或提交；平台交互请使用 interaction / action。页面不加载远端图片、脚本或字体。'),
    ]),
    node('main', { className: 'gallery' }, [
      node('article', { id: 'theme-default' }, [node('h2', { className: 'theme-label' }, '默认主题'), themeCard('Default', {}, '未设置共享覆盖')]),
      node('article', { id: 'theme-dark' }, [node('h2', { className: 'theme-label' }, '暗色共享主题'), themeCard('Dark', dark, '整棵组件树共享配色')]),
      node('article', { id: 'theme-project' }, [node('h2', { className: 'theme-label' }, '项目共享主题 + 局部覆盖'), themeCard('Project', project, '共享 typography / spacing / components')]),
    ]),
  ]),
]));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `<!doctype html>\n${html}\n`, 'utf8');
process.stdout.write(`${output}\n`);
