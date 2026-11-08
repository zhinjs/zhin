// Run after building @zhin.js/jsx and @zhin.js/components:
// node packages/toolkit/components/examples/gallery.mjs [output.html] [--serve]
import { mkdir, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jsx, rawHtml, renderToHtml } from '@zhin.js/jsx';
import {
  ThemeProvider, CardCanvas, Card, CardHeader, Surface, Section, Row, Col,
  Divider, KvTable, MetricBlock, StatChip, Badge, UsageBar, BarChart,
  RadarChart, Sparkline, TopicItem, ProfileRow, QuoteCard, EmptyState,
  Table, TableRow, TableCell, Checkbox, Radio, Switch, Button,
  List, ListItem, Markdown, CodeBlock,
  DonutChart, Callout, Timeline, StepTracker, ComparisonBar, StatusGrid, HeatmapGrid,
} from '../lib/index.js';

const INLINE_AVATAR_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#8b5cf6"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#g)"/><text x="32" y="40" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="24" font-weight="700">Z</text></svg>'
)}`;
const INLINE_WATERMARK_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><circle cx="90" cy="40" r="32" fill="#3b82f6" fill-opacity="0.18"/><path d="M20 65 L50 35 L75 50 L105 18" stroke="#6366f1" stroke-width="5" fill="none" stroke-linecap="round"/></svg>'
)}`;

let tw;
let tailwindUrl;
try {
  tailwindUrl = import.meta.resolve('@zhin.js/tailwind');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
if (tailwindUrl) {
  const { createTailwindStyle } = await import(tailwindUrl);
  tw = await createTailwindStyle({ theme: { '--color-brand': '#2563eb' } });
}

const args = process.argv.slice(2).filter(arg => arg !== '--');
const serveMode = args.includes('--serve');
const outputArg = args.find(arg => !arg.startsWith('--'));
const output = resolve(outputArg ?? join(tmpdir(), 'zhin-jsx-visual', 'gallery.html'));
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
    node(Table, { caption: '组合表格 · 单元格嵌套组件、固定列与批量选中态' }, [
      node(TableRow, { header: true, separator: false }, [
        node(TableCell, { header: true, width: '42%', fixed: 'left', icon: '📌' }, '负责人 / 项目'),
        node(TableCell, { header: true }, '进度'),
        node(TableCell, { header: true, align: 'right', fixed: 'right' }, '操作'),
      ]),
      node(TableRow, { selected: true }, [
        node(TableCell, { width: '42%', fixed: 'left', icon: '🚀' }, node(Col, { gap: 8 }, [
          badge('PM · 归雨'),
          node(Row, { gap: 8, wrap: true }, [badge('需求'), badge('设计')]),
        ])),
        node(TableCell, {}, node(Col, { gap: 8 }, [badge('进行中'), node(UsageBar, { percent: 68 })])),
        node(TableCell, { align: 'right', fixed: 'right' }, node(Button, { variant: 'secondary', size: 'sm', icon: '🔍' }, '查看')),
      ]),
      node(TableRow, {}, cells([
        node(Col, { gap: 8 }, [badge('QA · 林'), badge('验收')]),
        node(Checkbox, { checked: true, disabled: true, label: '完成', icon: '✅', badge: '100%' }),
        node(Button, { variant: 'primary', size: 'sm', badge: 'New' }, '报告'),
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
      node(Checkbox, { checked: true, label: node('strong', {}, '带图标与徽章'), icon: '🛡️', badge: '推荐', accent: '#8b5cf6' }),
      node(Radio, { checked: true, label: '高速通道', icon: '⚡', badge: 'Pro', accent: '#3b82f6' }),
      node(Switch, { checked: true, label: '自动巡检', icon: '🔔', badge: 'ON', accent: '#10b981' }),
    ]),
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
      node(Button, { accent: '#8b5cf6', icon: '✨', badge: 'v2' }, '图标与徽章'),
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
    section('table', 'Table / TableRow / TableCell · 固定列与批量选中', tableExamples()),
    section('layout', 'Row / Col · 明确 gap 与默认语义间距', layoutExamples()),
    section('lists', 'List / ListItem · 嵌套 JSX 与起始编号', listExamples()),
    section('markdown', 'Markdown · GFM 与安全边界', markdownExamples()),
    section('code', 'CodeBlock · 高亮、行号与长行阅读', codeExamples()),
    section('controls', 'Checkbox / Radio / Switch · 图标、徽章与状态', controlExamples()),
    section('buttons', 'Button · variant / size / icon / badge', buttonExamples()),
    section('metrics', '数值与图表 · 自定义中心图片与背景水印', [
      node(KvTable, { rows: [{ label: '环境', value: badge('Production') }, { label: '版本', value: '1.1.x' }] }),
      node(MetricBlock, { label: 'CPU', value: '8 / 16 cores', percent: 68 }),
      node(MetricBlock, { label: '内存', value: '12.4 GB', percent: 42, accent: '#8b5cf6' }),
      node(Row, { gap: 20, wrap: true, align: 'center' }, [
        node(DonutChart, {
          percent: 78,
          label: '集群健康度',
          sublabel: '24/24 节点在线',
          centerImage: INLINE_AVATAR_SVG,
          icon: '🛰️',
        }),
        node(DonutChart, {
          percent: 64,
          label: 'Token 预算',
          valueText: '64%',
          accent: '#8b5cf6',
        }),
      ]),
      node(BarChart, {
        values: [2, 7, 5, 12, 9, 4],
        peakIndex: 3,
        tickLabels: ['08:00', '12:00', '16:00'],
        images: [INLINE_AVATAR_SVG, undefined, undefined, INLINE_AVATAR_SVG],
        icons: ['🌱', '⚡', '🔥', '👑', '🚀', '✨'],
        backgroundImage: INLINE_WATERMARK_SVG,
      }),
      node(Row, { gap: 24, wrap: true, align: 'center' }, [
        node(RadarChart, {
          labels: ['稳定', '速度', '覆盖', '可读', '扩展'],
          values: [85, 72, 92, 65, 88],
          max: 100,
          size: 180,
          centerImage: INLINE_AVATAR_SVG,
        }),
        node(Sparkline, {
          values: [2, 5, 3, 8, 6, 12, 9],
          width: 140,
          height: 44,
          endImage: INLINE_AVATAR_SVG,
        }),
      ]),
      node(ComparisonBar, {
        leftLabel: '缓存命中 (76%)',
        rightLabel: '回源请求 (24%)',
        leftValue: 76,
        rightValue: 24,
      }),
      node(StatusGrid, {
        columns: 4,
        items: [
          { label: 'QQ 网关', status: 'ok', detail: '21ms' },
          { label: 'Discord', status: 'ok', detail: '38ms' },
          { label: 'Telegram', status: 'warn', detail: '重试 1' },
          { label: 'Sandbox', status: 'ok', detail: '就绪' },
        ],
      }),
      node(HeatmapGrid, {
        columns: 7,
        values: [1, 3, 5, 2, 8, 9, 4, 2, 6, 10, 7, 4, 1, 3],
        max: 10,
      }),
    ]),
    section('timeline', 'Callout / Timeline / StepTracker · 流程与告警反馈', [
      node(Callout, { tone: 'info', title: '热重载就绪', message: '修改组件源码后可在预览服务中实时查看内联样式效果。' }),
      node(StepTracker, {
        current: 1,
        steps: [
          { label: '构建契约', description: '已完成' },
          { label: '视觉调优', description: '进行中' },
          { label: '快照回归', description: '待执行' },
        ],
      }),
      node(Timeline, {
        items: [
          { title: '加载插件蓝图', time: '09:00', badge: 'OK', accent: '#10b981', description: '零闭包 JSON 蓝图校验通过' },
          { title: '渲染 IM 图卡', time: '09:01', badge: '24ms', accent: '#3b82f6', description: '生成自包含内联样式与 SVG 节点' },
        ],
      }),
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

if (serveMode) {
  const port = Number(process.env.PORT || 4175);
  const clients = new Set();
  const devEnhancement = `
<style>
  .dev-toolbar { position: sticky; top: 0; z-index: 999; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(8px); color: #f8fafc; padding: 10px 20px; border-radius: 10px; max-width: 1696px; margin: 0 auto 20px; font-size: 13px; box-shadow: 0 8px 24px rgba(15,23,42,0.18); }
  .dev-toolbar select, .dev-toolbar button { background: #1e293b; color: #f8fafc; border: 1px solid #475569; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
  .dev-toolbar button[data-active="true"] { background: #3b82f6; border-color: #60a5fa; }
  body.debug-outlines [data-gallery-section] * { outline: 1px dashed rgba(236, 72, 153, 0.45) !important; }
</style>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.className = 'dev-toolbar';
    bar.innerHTML = \`
      <strong>🛠️ 组件样式调试栏</strong>
      <label>分区过滤：
        <select id="dev-sec">
          <option value="all">全部组件分区</option>
          <option value="table">Table 表格</option>
          <option value="controls">Checkbox / Radio / Switch</option>
          <option value="buttons">Button 按钮</option>
          <option value="metrics">Charts 图表与指标</option>
          <option value="timeline">Callout / Timeline / StepTracker</option>
          <option value="layout">Layout 布局</option>
          <option value="lists">List 列表</option>
          <option value="markdown">Markdown</option>
          <option value="code">CodeBlock 代码</option>
          <option value="spacing">默认间距</option>
          <option value="local">局部主题覆盖</option>
        </select>
      </label>
      <label>主题过滤：
        <select id="dev-theme">
          <option value="all">三套主题并排对比</option>
          <option value="theme-default">仅 Default</option>
          <option value="theme-dark">仅 Dark</option>
          <option value="theme-project">仅 Project</option>
        </select>
      </label>
      <button id="dev-outline" type="button">📐 显示间距/盒模型辅助线</button>
      <span style="margin-left:auto;opacity:0.75">已启用实时刷新 (SSE)</span>
    \`;
    document.body.insertBefore(bar, document.body.firstChild);
    const secSel = document.getElementById('dev-sec');
    const themeSel = document.getElementById('dev-theme');
    const outlineBtn = document.getElementById('dev-outline');
    secSel.value = sessionStorage.getItem('zhin.gallery.sec') || 'all';
    themeSel.value = sessionStorage.getItem('zhin.gallery.theme') || 'all';
    if (sessionStorage.getItem('zhin.gallery.outline') === '1') {
      document.body.classList.add('debug-outlines');
      outlineBtn.dataset.active = 'true';
    }
    const applyFilter = () => {
      sessionStorage.setItem('zhin.gallery.sec', secSel.value);
      sessionStorage.setItem('zhin.gallery.theme', themeSel.value);
      document.querySelectorAll('[data-gallery-section]').forEach(el => {
        el.style.display = (secSel.value === 'all' || el.getAttribute('data-gallery-section') === secSel.value) ? '' : 'none';
      });
      document.querySelectorAll('main.gallery > article').forEach(el => {
        el.style.display = (themeSel.value === 'all' || el.id === themeSel.value) ? '' : 'none';
      });
    };
    secSel.addEventListener('change', applyFilter);
    themeSel.addEventListener('change', applyFilter);
    outlineBtn.addEventListener('click', () => {
      const on = document.body.classList.toggle('debug-outlines');
      outlineBtn.dataset.active = String(on);
      sessionStorage.setItem('zhin.gallery.outline', on ? '1' : '0');
    });
    applyFilter();
    const es = new EventSource('/__events');
    es.onmessage = () => location.reload();
  });
</script>`;
  const server = createServer(async (req, res) => {
    if (req.url === '/__events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 300\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>\n${html.replace('</head>', `${devEnhancement}</head>`)}\n`);
  });
  const libDir = fileURLToPath(new URL('../lib', import.meta.url));
  try {
    watch(libDir, { recursive: true }, () => {
      for (const client of clients) client.write('data: reload\n\n');
    });
  } catch { /* ignore if watch unsupported */ }
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Component gallery dev server listening on http://127.0.0.1:${port}\n`);
  });
}
