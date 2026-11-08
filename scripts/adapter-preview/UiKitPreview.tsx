import React, { useState } from 'react';
import {
  PluginPage,
  pluginUiStyles,
  PageHeader,
  Section,
  StatGrid,
  StatCard,
  Badge,
  Tag,
  Button,
  Input,
  Select,
  Switch,
  Checkbox,
  CheckboxGroup,
  RadioGroup,
  SegmentedControl,
  RingProgress,
  Sparkline,
  BarChart,
  DonutChart,
  DataTable,
  Notice,
  Timeline,
  Tabs,
  Modal,
  Drawer,
  DescriptionList,
  CodeBlock,
  EmptyState,
  ProgressBar,
  type UiSize,
  type UiTone,
} from '../../packages/console/client/client/ui/index.js';

const AVATAR_BLUE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#6366f1"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#b)"/><text x="32" y="41" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="26" font-weight="700">Z</text></svg>'
)}`;

const AVATAR_EMERALD = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#10b981"/><text x="32" y="41" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="24" font-weight="700">AI</text></svg>'
)}`;

const WATERMARK_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle cx="80" cy="80" r="36" fill="none" stroke="#3b82f6" stroke-width="8"/><path d="M20 95 L52 55 L76 74 L106 28" fill="none" stroke="#6366f1" stroke-width="8" stroke-linecap="round"/></svg>'
)}`;

interface NodeRow {
  readonly id: string;
  readonly name: string;
  readonly adapter: string;
  readonly status: 'online' | 'warning' | 'offline';
  readonly region: string;
  readonly qps: number;
  readonly latency: string;
  readonly tokens: string;
  readonly health: number;
}

const INITIAL_ROWS: readonly NodeRow[] = [
  { id: 'node-01', name: 'QQ 主力群管机器人', adapter: 'icqq', status: 'online', region: 'ap-shanghai', qps: 142, latency: '18 ms', tokens: '1.24M', health: 98 },
  { id: 'node-02', name: 'Discord 社区助手', adapter: 'discord', status: 'online', region: 'us-west', qps: 89, latency: '42 ms', tokens: '860K', health: 94 },
  { id: 'node-03', name: 'Telegram 资讯推送', adapter: 'telegram', status: 'warning', region: 'ap-singapore', qps: 64, latency: '115 ms', tokens: '530K', health: 76 },
  { id: 'node-04', name: '飞书研发值班 Bot', adapter: 'feishu', status: 'online', region: 'ap-beijing', qps: 51, latency: '23 ms', tokens: '410K', health: 96 },
  { id: 'node-05', name: '沙箱回归测试节点', adapter: 'sandbox', status: 'offline', region: 'local-dev', qps: 0, latency: '—', tokens: '12K', health: 0 },
];

export function UiKitPreview() {
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [viewportWidth, setViewportWidth] = useState<string>('100%');
  const [size, setSize] = useState<UiSize>('md');
  const [tone, setTone] = useState<UiTone>('primary');
  const [debugOutline, setDebugOutline] = useState(false);

  // Interactive states for controls
  const [radioCard, setRadioCard] = useState('balanced');
  const [radioBtn, setRadioBtn] = useState('realtime');
  const [checkedItems, setCheckedItems] = useState<string[]>(['qq', 'discord']);
  const [singleCheck, setSingleCheck] = useState(true);
  const [indeterminateCheck, setIndeterminateCheck] = useState(true);
  const [switchOn, setSwitchOn] = useState(true);
  const [segmentVal, setSegmentVal] = useState('overview');
  const [barHorizontal, setBarHorizontal] = useState(false);

  // Table states
  const [selectedKeys, setSelectedKeys] = useState<string[]>(['node-01', 'node-03']);
  const [responsiveStack, setResponsiveStack] = useState(false);
  const [lastBatchMsg, setLastBatchMsg] = useState<string>('');

  // Overlay states
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('tab-1');

  const showSection = (key: string) => sectionFilter === 'all' || sectionFilter === key;

  return (
    <div>
      {/* Developer Sticky Inspector Toolbar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '10px 16px',
          padding: '10px 24px',
          background: 'var(--zk-surface-elevated, #f8fafc)',
          borderBottom: '1px solid var(--zk-border, #e2e8f0)',
          fontSize: 12,
        }}
      >
        <strong style={{ fontSize: 13 }}>🎨 UI 样式实时调试台 (Vite HMR)</strong>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>分区：</span>
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--zk-border, #cbd5e1)', background: 'transparent', color: 'inherit' }}
          >
            <option value="all">全部组件分类</option>
            <option value="controls">1. 单选 / 多选 / 分段 / 按钮 (图标与卡片态)</option>
            <option value="charts">2. 图表与指标卡片 (自定义图片与水印)</option>
            <option value="table">3. 表格 (列 Fixed 固定 / 批量操作 / 展开行)</option>
            <option value="feedback">4. 反馈 / 导航 / 弹窗 / 抽屉</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>视口宽度 (测试响应式)：</span>
          <select
            value={viewportWidth}
            onChange={(e) => setViewportWidth(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--zk-border, #cbd5e1)', background: 'transparent', color: 'inherit' }}
          >
            <option value="100%">自适应全宽 (100%)</option>
            <option value="1100px">Desktop (1100px)</option>
            <option value="820px">Tablet (820px · 测试固定列横向滚动)</option>
            <option value="600px">Mobile 大屏 (600px)</option>
            <option value="390px">Mobile 手机 (390px · 卡片折叠)</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>全局尺寸 (UiSize)：</span>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value as UiSize)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--zk-border, #cbd5e1)', background: 'transparent', color: 'inherit' }}
          >
            <option value="sm">sm (紧凑)</option>
            <option value="md">md (标准)</option>
            <option value="lg">lg (宽松)</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>语义色 (UiTone)：</span>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as UiTone)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--zk-border, #cbd5e1)', background: 'transparent', color: 'inherit' }}
          >
            <option value="primary">primary</option>
            <option value="success">success</option>
            <option value="warning">warning</option>
            <option value="danger">danger</option>
            <option value="info">info</option>
            <option value="neutral">neutral</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={debugOutline} onChange={(e) => setDebugOutline(e.target.checked)} />
          <span>📐 盒模型辅助线</span>
        </label>
      </div>

      {debugOutline ? (
        <style>{`.zk-root * { outline: 1px dashed rgba(236, 72, 153, 0.38) !important; }`}</style>
      ) : null}

      <div
        style={{
          maxWidth: viewportWidth,
          margin: viewportWidth === '100%' ? '0' : '16px auto',
          border: viewportWidth === '100%' ? 'none' : '2px dashed rgba(59, 130, 246, 0.45)',
          borderRadius: viewportWidth === '100%' ? 0 : 16,
          transition: 'max-width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        <PluginPage>
          <style>{pluginUiStyles}</style>
          <PageHeader
            eyebrow="Zhin UI Design System v2"
            title="组件规范与交互预览工作台"
            description="直接引用 packages/console/client/client/ui 源码，修改 styles.ts 或 components.tsx 保存即可毫秒级热更新预览。"
            badge={<Badge tone={tone} size={size} dot>HMR 实时生效</Badge>}
            actions={
              <div className="zk-row">
                <Button variant="secondary" size={size} icon={<span>🪟</span>} onClick={() => setModalOpen(true)}>
                  预览 Modal 弹窗
                </Button>
                <Button variant="primary" size={size} icon={<span>🗂️</span>} onClick={() => setDrawerOpen(true)}>
                  预览 Drawer 抽屉
                </Button>
              </div>
            }
          />

          {/* 1. Charts & Metrics with Custom Images */}
          {showSection('charts') && (
            <>
              <StatGrid>
                <StatCard
                  label="活跃适配器节点"
                  value="24"
                  suffix="个"
                  tone="primary"
                  image={AVATAR_BLUE}
                  watermark={<img src={WATERMARK_SVG} alt="" />}
                  badge={{ text: '+18%', tone: 'success' }}
                  trend={{ direction: 'up', value: '+4 新增', label: '较昨日' }}
                  sparkline={[8, 12, 11, 15, 18, 21, 24]}
                />
                <StatCard
                  label="AI 会话健康度"
                  value="96.4"
                  suffix="%"
                  tone="success"
                  image={AVATAR_EMERALD}
                  ringProgress={96.4}
                  hint="包含自定义头像与环形进度指示"
                />
                <StatCard
                  label="今日消息吞吐"
                  value="128.5K"
                  tone={tone}
                  icon={<span>⚡</span>}
                  watermark={<span style={{ fontSize: 64 }}>⚡</span>}
                  sparkline={[32, 48, 41, 65, 88, 74, 128]}
                  hint="右下角支持自定义背景水印"
                />
              </StatGrid>

              <Section
                title="图表组件 · 支持自定义图片 (centerImage / markerImage / watermark)"
                description="DonutChart、BarChart、RingProgress、Sparkline 均支持嵌入图片头像、图标与背景水印。"
                actions={
                  <Switch
                    checked={barHorizontal}
                    onChange={setBarHorizontal}
                    size={size}
                    icon={<span>📊</span>}
                    label="切换水平/垂直柱状图"
                  />
                }
              >
                <div className="zk-split">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                      DonutChart (多段环形图 · 中心自定义头像与图例图标)
                    </div>
                    <DonutChart
                      size={136}
                      centerImage={AVATAR_BLUE}
                      label="总Token分布"
                      sublabel="2.84M"
                      segments={[
                        { label: 'QQ 群聊助手', value: 1240, tone: 'primary', image: AVATAR_BLUE },
                        { label: 'Discord 社区', value: 860, tone: 'info', icon: <span>💬</span> },
                        { label: 'Telegram 频道', value: 530, tone: 'success', icon: <span>✈️</span> },
                        { label: '飞书研发值班', value: 210, tone: 'warning', icon: <span>🛠️</span> },
                      ]}
                    />

                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 20, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <RingProgress value={82} size={64} strokeWidth={6} tone={tone} centerImage={AVATAR_EMERALD} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>RingProgress 头像中心</div>
                          <div style={{ fontSize: 12, color: 'var(--zk-text-muted)' }}>centerImage 圆形裁切</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Sparkline
                          data={[12, 28, 19, 45, 36, 62, 58, 84]}
                          width={160}
                          height={44}
                          tone={tone}
                          markerImage={AVATAR_BLUE}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Sparkline 末端图片</div>
                          <div style={{ fontSize: 12, color: 'var(--zk-text-muted)' }}>markerImage + 峰值点</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                      BarChart ({barHorizontal ? '水平排行模式' : '垂直柱状模式'} · 支持每列图片/图标与背景水印)
                    </div>
                    <BarChart
                      horizontal={barHorizontal}
                      height={160}
                      watermark={<img src={WATERMARK_SVG} alt="" style={{ width: 96, height: 96 }} />}
                      data={[
                        { label: 'ICQQ', value: 142, tone: 'primary', image: AVATAR_BLUE },
                        { label: 'Discord', value: 98, tone: 'info', icon: <span>🎮</span> },
                        { label: 'Telegram', value: 76, tone: 'success', image: AVATAR_EMERALD },
                        { label: 'Feishu', value: 64, tone: 'warning', icon: <span>🏢</span> },
                        { label: 'Slack', value: 41, tone: 'neutral', icon: <span>💼</span> },
                      ]}
                    />
                  </div>
                </div>
              </Section>
            </>
          )}

          {/* 2. Controls with Icons, Badges & Card/Button Variants */}
          {showSection('controls') && (
            <Section
              title="单选 / 多选 / 分段控制器 · 支持图标、徽章与卡片/按钮形态"
              description="统一支持 size (sm/md/lg)、icon、badge、description、indeterminate 及 card/button 布局。"
            >
              <div className="zk-stack">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                    SegmentedControl (带图标与计数徽章)
                  </div>
                  <SegmentedControl
                    size={size}
                    value={segmentVal}
                    onChange={setSegmentVal}
                    options={[
                      { value: 'overview', label: '总览视图', icon: <span>📊</span>, badge: 5 },
                      { value: 'endpoints', label: '活跃节点', icon: <span>🛰️</span>, badge: 24 },
                      { value: 'alerts', label: '告警事件', icon: <span>⚠️</span>, badge: 2 },
                    ]}
                  />
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                    RadioGroup · Card 网格卡片形态 (variant="card" direction="grid")
                  </div>
                  <RadioGroup
                    variant="card"
                    direction="grid"
                    size={size}
                    value={radioCard}
                    onChange={setRadioCard}
                    options={[
                      {
                        value: 'fast',
                        label: '极速响应模式',
                        icon: <span>⚡</span>,
                        badge: <Badge tone="info" size="sm">Flash</Badge>,
                        description: '优先使用低延迟轻量模型，适合高频群聊互动。',
                      },
                      {
                        value: 'balanced',
                        label: '均衡推理模式',
                        icon: <span>⚖️</span>,
                        badge: <Badge tone="primary" size="sm">推荐</Badge>,
                        description: '自动根据任务复杂度在速度与深度推理之间平衡。',
                      },
                      {
                        value: 'deep',
                        label: '深度思考模式',
                        icon: <span>🧠</span>,
                        badge: <Badge tone="warning" size="sm">Pro</Badge>,
                        description: '启用多步工具调用与长上下文规划，适合复杂任务。',
                      },
                    ]}
                  />
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                    RadioGroup · Button 按钮组形态 (variant="button")
                  </div>
                  <RadioGroup
                    variant="button"
                    size={size}
                    value={radioBtn}
                    onChange={setRadioBtn}
                    options={[
                      { value: 'realtime', label: '实时流式输出', icon: <span>🌊</span>, badge: 'SSE' },
                      { value: 'batch', label: '整段合并回复', icon: <span>📦</span> },
                      { value: 'card', label: '渲染图片图卡', icon: <span>🖼️</span>, badge: 'Shotium' },
                    ]}
                  />
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                    CheckboxGroup · 多选卡片网格 (variant="card" direction="grid")
                  </div>
                  <CheckboxGroup
                    variant="card"
                    direction="grid"
                    size={size}
                    value={checkedItems}
                    onChange={setCheckedItems}
                    options={[
                      {
                        value: 'qq',
                        label: 'QQ / OneBot 适配器',
                        icon: <span>🐧</span>,
                        badge: <Badge tone="success" size="sm">已连接</Badge>,
                        description: '支持群聊、私聊、表情回应与合并转发。',
                      },
                      {
                        value: 'discord',
                        label: 'Discord 适配器',
                        icon: <span>🎮</span>,
                        badge: <Badge tone="primary" size="sm">Slash</Badge>,
                        description: '支持频道线程、Embed 卡片与按钮交互。',
                      },
                      {
                        value: 'telegram',
                        label: 'Telegram 适配器',
                        icon: <span>✈️</span>,
                        badge: <Badge tone="neutral" size="sm">Webhook</Badge>,
                        description: '支持 Inline Keyboard 与高清媒体流。',
                      },
                    ]}
                  />
                </div>

                <div className="zk-row" style={{ gap: 20 }}>
                  <Checkbox
                    size={size}
                    checked={singleCheck}
                    onChange={setSingleCheck}
                    icon={<span>🛡️</span>}
                    badge={<Badge tone="success" size="sm">安全</Badge>}
                    label="启用工具执行沙箱审批"
                  />
                  <Checkbox
                    size={size}
                    checked={indeterminateCheck}
                    indeterminate={indeterminateCheck}
                    onChange={setIndeterminateCheck}
                    icon={<span>📑</span>}
                    label="半选状态 (indeterminate)"
                  />
                  <Switch
                    size={size}
                    checked={switchOn}
                    onChange={setSwitchOn}
                    icon={<span>🔔</span>}
                    label="异常自动熔断通知"
                  />
                </div>

                <div className="zk-row">
                  <Button variant="primary" size={size} icon={<span>🚀</span>} trailingIcon={<span>→</span>}>
                    主操作按钮 ({size})
                  </Button>
                  <Button variant="secondary" size={size} icon={<span>⚙️</span>}>
                    次级按钮
                  </Button>
                  <Button variant="success" size={size} icon={<span>✓</span>}>
                    成功状态
                  </Button>
                  <Button variant="warning" size={size} icon={<span>⚠️</span>}>
                    警告操作
                  </Button>
                  <Button variant="danger" size={size} icon={<span>🗑️</span>}>
                    危险删除
                  </Button>
                </div>
              </div>
            </Section>
          )}

          {/* 3. DataTable with Sticky Columns, Batch Actions & Expandable Rows */}
          {showSection('table') && (
            <Section
              title="DataTable · 支持列 Fixed (左右粘滞固定)、批量选择操作栏、行内操作与详情展开"
              description="缩小顶部「视口宽度」至 820px 并在表格内横向滚动，即可直观查看左侧固定列与右侧固定列的阴影吸附效果。"
              actions={
                <Checkbox
                  size="sm"
                  checked={responsiveStack}
                  onChange={setResponsiveStack}
                  label="窄屏启用卡片堆叠 (responsiveStack)"
                />
              }
            >
              {lastBatchMsg ? (
                <div style={{ marginBottom: 12 }}>
                  <Notice tone="success" onDismiss={() => setLastBatchMsg('')}>
                    {lastBatchMsg}
                  </Notice>
                </div>
              ) : null}

              <DataTable<NodeRow>
                rowKey="id"
                rows={INITIAL_ROWS}
                selectable
                selectedKeys={selectedKeys}
                onSelectionChange={(keys) => setSelectedKeys(keys)}
                responsiveStack={responsiveStack}
                batchActions={[
                  {
                    key: 'restart',
                    label: '批量重启节点',
                    variant: 'primary',
                    icon: <span>🔄</span>,
                    onClick: (_rows, keys) => setLastBatchMsg(`已触发批量重启：${keys.join(', ')}`),
                  },
                  {
                    key: 'export',
                    label: '导出诊断快照',
                    variant: 'secondary',
                    icon: <span>📥</span>,
                    onClick: (_rows, keys) => setLastBatchMsg(`已导出 ${keys.length} 个节点的配置快照`),
                  },
                  {
                    key: 'Offline',
                    label: '批量下线',
                    variant: 'danger',
                    icon: <span>⏹️</span>,
                    onClick: (_rows, keys) => setLastBatchMsg(`已下线节点：${keys.join(', ')}`),
                  },
                ]}
                rowActions={(row) => (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLastBatchMsg(`已对 ${row.name} (${row.id}) 执行单行巡检`)}
                    >
                      巡检
                    </Button>
                  </>
                )}
                renderExpandedRow={(row) => (
                  <DescriptionList
                    columns={3}
                    items={[
                      { label: '节点唯一标识', value: row.id, mono: true, copyable: true },
                      { label: '所属可用区', value: row.region, mono: true },
                      { label: '协议适配器', value: row.adapter },
                      { label: '累计消耗 Token', value: row.tokens },
                      { label: '当前健康评分', value: `${row.health} / 100` },
                      { label: '心跳延迟', value: row.latency },
                    ]}
                  />
                )}
                columns={[
                  {
                    key: 'id',
                    label: '节点 ID',
                    width: 110,
                    fixed: 'left',
                    mono: true,
                    sortable: true,
                  },
                  {
                    key: 'name',
                    label: '实例名称 (Fixed Left)',
                    width: 200,
                    fixed: 'left',
                    icon: <span>🤖</span>,
                    sortable: true,
                  },
                  {
                    key: 'adapter',
                    label: '适配器',
                    width: 120,
                    render: (v) => <Tag tone="info" size={size}>{String(v)}</Tag>,
                  },
                  {
                    key: 'status',
                    label: '运行状态',
                    width: 130,
                    render: (v) => (
                      <Badge
                        dot
                        size={size}
                        tone={v === 'online' ? 'success' : v === 'warning' ? 'warning' : 'danger'}
                      >
                        {String(v)}
                      </Badge>
                    ),
                  },
                  {
                    key: 'region',
                    label: '地域可用区',
                    width: 150,
                    mono: true,
                  },
                  {
                    key: 'qps',
                    label: '实时 QPS',
                    width: 120,
                    align: 'right',
                    sortable: true,
                  },
                  {
                    key: 'latency',
                    label: '平均延迟',
                    width: 120,
                    align: 'right',
                    mono: true,
                  },
                  {
                    key: 'tokens',
                    label: 'Token 用量',
                    width: 130,
                    align: 'right',
                  },
                  {
                    key: 'health',
                    label: '健康度 (Fixed Right)',
                    width: 160,
                    fixed: 'right',
                    align: 'right',
                    render: (v) => <ProgressBar value={Number(v)} showValue tone={Number(v) > 85 ? 'success' : Number(v) > 0 ? 'warning' : 'danger'} />,
                  },
                ]}
              />
            </Section>
          )}

          {/* 4. Feedback, Tabs, Timeline, Modal & Drawer */}
          {showSection('feedback') && (
            <Section
              title="反馈、时间线、代码块与多断点弹层"
              description="在 ≤639px 手机视口下，Modal 自动变为底部抽屉 (Bottom Sheet)，Tabs 自动支持无滚动条横向滑动。"
            >
              <div className="zk-stack">
                <Tabs
                  activeKey={activeTab}
                  onChange={setActiveTab}
                  items={[
                    { key: 'tab-1', label: '时间线与状态通知', badge: 2 },
                    { key: 'tab-2', label: '代码块与空状态' },
                  ]}
                />

                {activeTab === 'tab-1' && (
                  <div className="zk-stack">
                    <Notice tone={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'info'}>
                      当前全局尺寸为 <code>{size}</code>，语义色为 <code>{tone}</code>。可通过页面顶部工具栏一键切换验证所有组件联动效果。
                    </Notice>
                    <Timeline
                      items={[
                        {
                          key: '1',
                          title: '单选与多选组件支持图标与卡片态',
                          time: '刚刚',
                          tone: 'success',
                          detail: 'Checkbox / CheckboxGroup / RadioGroup / SegmentedControl 全面支持 icon、badge 与 card 变体。',
                        },
                        {
                          key: '2',
                          title: 'DataTable 支持 Fixed 粘滞列与批量操作栏',
                          time: '2 分钟前',
                          tone: 'info',
                          detail: '支持多列左右固定偏移计算、阴影层级与勾选后的悬浮批量操作栏。',
                        },
                      ]}
                    />
                  </div>
                )}

                {activeTab === 'tab-2' && (
                  <div className="zk-split">
                    <CodeBlock
                      title="definePageBlueprint 示例"
                      language="typescript"
                      code={`export default definePageBlueprint({\n  pluginId: 'my-plugin',\n  title: '服务状态',\n  stats: [{ key: 'qps', label: 'QPS', expr: { $path: 'qps' } }],\n});`}
                    />
                    <EmptyState
                      title="暂无未处理的异常告警"
                      description="所有适配器端点均处于健康连接状态。"
                    />
                  </div>
                )}
              </div>
            </Section>
          )}

          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="响应式 Modal 弹窗预览"
            description="在手机窄屏 (≤639px) 下会自动贴底弹出 (Bottom Sheet)。"
            footer={
              <>
                <Button variant="secondary" size={size} onClick={() => setModalOpen(false)}>取消</Button>
                <Button variant="primary" size={size} onClick={() => setModalOpen(false)}>确认提交</Button>
              </>
            }
          >
            <div className="zk-stack">
              <Input label="配置项名称" placeholder="请输入名称" size={size} defaultValue="production-gateway" />
              <Select
                label="日志级别"
                size={size}
                value="info"
                onChange={() => {}}
                options={[
                  { value: 'debug', label: 'Debug (调试)' },
                  { value: 'info', label: 'Info (标准)' },
                  { value: 'warn', label: 'Warn (警告)' },
                ]}
              />
            </div>
          </Modal>

          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title="响应式 Drawer 侧边抽屉预览"
            description="在 ≤767px 下自动适配为全宽抽屉。"
            footer={
              <Button variant="primary" size={size} onClick={() => setDrawerOpen(false)}>关闭抽屉</Button>
            }
          >
            <DescriptionList
              columns={1}
              items={[
                { label: '组件包', value: '@zhin.js/client/ui', mono: true },
                { label: '样式前缀', value: '.zk-* (Shadow / Page Shell 隔离)', mono: true },
                { label: '热更新方式', value: 'Vite 源码直连 HMR' },
              ]}
            />
          </Drawer>
        </PluginPage>
      </div>
    </div>
  );
}
