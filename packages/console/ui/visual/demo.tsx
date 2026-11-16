/**
 * Component gallery of @zhin.js/console-ui: the visual regression cases (visual/console-ui.spec.ts)
 * and the layout audit gate (visual/audit.spec.ts, ADR 0063 D20). Built only from package
 * components and package CSS — no inline sizes — so it is also the reference for pages.
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, Inbox, Pencil, RefreshCw, Trash2, Users } from 'lucide-react'
import {
  Alert, AlertDescription, AlertTitle, Badge, BrandMark, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Checkbox, ConfirmDialog, ConsoleUiI18nProvider, DateField, DateTimeField, EMPTY_ILLUSTRATIONS, EmptyState, ErrorAlert, Grid,
  InlineCode, Input, ListDetail, MiniRingGauge,
  PageChromeActions, PageChromeProvider, PageHeader, PageShell, RowActions, SearchableSelectField, Section,
  SelectField, StatCard, StatGrid, StatusBadge, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Tabs, TabsContent, TabsList, TabsTrigger, Textarea, createPageChromeStore, usePageChrome, type PageAction,
} from '../client/index.js'

const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const locale = params.get('locale') ?? 'zh-CN'
const width = params.get('width') === 'reading' ? 'reading' : 'data'
document.documentElement.classList.toggle('dark', theme === 'dark')
document.documentElement.lang = locale

/** Fixed clock so 「更新于 hh:mm:ss」 is stable in screenshots. */
const UPDATED_AT = new Date(2026, 10, 15, 9, 30, 15)
const noop = () => undefined

const FEEDS = [
  { id: 'zhin', name: 'Zhin 发布', status: 'ok' as const, statusLabel: '正常', items: 128, target: '群 10001' },
  { id: 'weekly', name: '技术周刊', status: 'warning' as const, statusLabel: '拉取失败', items: 42, target: '群 10002' },
  { id: 'blog', name: '官方博客', status: 'ok' as const, statusLabel: '正常', items: 7, target: '私聊 owner' },
]

function PluginContent() {
  const [model, setModel] = useState('gpt')
  usePageChrome({
    refresh: { onRefresh: noop, updatedAt: UPDATED_AT },
    actions: <Button variant="destructive-outline">移除订阅</Button>,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>通过 usePageChrome 交给外壳的页头操作</CardTitle>
        <CardDescription>刷新控件和危险操作按钮由外壳摆放在页头。</CardDescription>
      </CardHeader>
      <CardContent>
        <SearchableSelectField
          aria-label="模型"
          value={model}
          onValueChange={setModel}
          options={[
            { value: '', label: '未设置' },
            { value: 'gpt', label: 'gpt-5', group: 'OpenAI', description: 'gpt-5 · default' },
            { value: 'claude', label: 'claude-opus', group: 'Anthropic' },
          ]}
        />
      </CardContent>
    </Card>
  )
}

function FeedTable({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>状态</TableHead>
          <TableHead priority="secondary">推送到</TableHead>
          <TableHead numeric>条目</TableHead>
          <TableHead><span className="sr-only">操作</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {FEEDS.map(feed => (
          <TableRow key={feed.id}>
            <TableCell>{feed.name}</TableCell>
            <TableCell><StatusBadge status={feed.status}>{feed.statusLabel}</StatusBadge></TableCell>
            <TableCell priority="secondary">{feed.target}</TableCell>
            <TableCell numeric>{feed.items}</TableCell>
            <TableCell>
              <RowActions
                primary={{ label: '查看', onSelect: () => onOpen(feed.id) }}
                more={[
                  { label: '编辑', icon: Pencil, onSelect: noop },
                  { label: '立即拉取', icon: RefreshCw, onSelect: noop },
                  { label: '删除', icon: Trash2, tone: 'destructive', onSelect: noop },
                ]}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Gallery() {
  const [chrome] = useState(createPageChromeStore)
  const [mode, setMode] = useState('all')
  const [fallback, setFallback] = useState('')
  const [day, setDay] = useState('2026-11-16')
  const [since, setSince] = useState('2026-11-16T09:30')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const selectedFeed = FEEDS.find(feed => feed.id === selected)
  const headerActions: PageAction[] = [
    { label: '新建订阅', tone: 'primary', onSelect: noop },
    { label: '导入', onSelect: noop },
    { label: '导出', onSelect: noop },
  ]
  return (
    <ConsoleUiI18nProvider locale={locale}>
      <PageShell width={width}>
        <PageHeader
          title="组件示例"
          description="@zhin.js/console-ui 的按钮、输入框、下拉框、表格、对话框与页面外壳。"
          actions={<PageChromeActions store={chrome} />}
          menuActions={headerActions}
          moreActions={[{ label: '清空记录', tone: 'destructive', onSelect: () => setConfirmOpen(true) }]}
        />
        <StatGrid label="统计">
          <StatCard icon={Activity} label="消息" value="1,284" sub="过去 24 小时" />
          <StatCard icon={Users} label="会话" value="36" aside={<MiniRingGauge percent={72} />} />
          <StatCard icon={Inbox} label="待处理" value="3" tone="warning" sub="需要处理" />
          <StatCard icon={Activity} label="错误" value="1" tone="danger" onOpen={noop} />
          <StatCard icon={Activity} label="失败" value="0" tone="danger" sub="稳态不着色" />
        </StatGrid>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6">
            <BrandMark size="sm" />
            <BrandMark />
            <BrandMark size="lg" />
            <BrandMark withText />
            <BrandMark size="lg" withText />
          </CardContent>
        </Card>
        <Grid min="20rem">
          <Card>
            <CardHeader>
              <CardTitle>按钮</CardTitle>
              <CardDescription>每个视图最多一个实心主按钮；页面上的危险操作用幽灵或描边样式，实心红色只在确认对话框里出现。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button variant="primary">主要操作</Button>
              <Button variant="soft">柔和</Button>
              <Button variant="secondary">次要</Button>
              <Button variant="outline">描边</Button>
              <Button variant="ghost">幽灵</Button>
              <Button variant="link">链接</Button>
              <Button variant="destructive-outline" onClick={() => setConfirmOpen(true)}>删除数据</Button>
              <Button variant="destructive">移除</Button>
              <Button variant="destructive-solid">确认删除</Button>
              <Button size="sm">小号</Button>
              <Button disabled>禁用</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>输入</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Input aria-label="订阅地址" placeholder="订阅地址" defaultValue="https://example.com/feed.xml" />
              <Input aria-label="未填写的字段" placeholder="未填写" aria-invalid="true" />
              <SelectField
                aria-label="筛选"
                value={mode}
                onValueChange={setMode}
                options={[{ value: 'all', label: '全部' }, { value: 'active', label: '启用中' }, { value: 'paused', label: '已暂停' }]}
              />
              <Textarea aria-label="备注" placeholder="备注" rows={2} />
              <Input variant="ghost" aria-label="备用地址" placeholder="备用地址（ghost，悬停或聚焦时才有边框）" />
              <SelectField
                variant="ghost"
                aria-label="备用模型"
                value={fallback}
                onValueChange={setFallback}
                options={[{ value: '', label: '未设置备用模型' }, { value: 'mini', label: 'gpt-5-mini' }]}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <DateField aria-label="日期" value={day} onValueChange={setDay} />
                <DateTimeField aria-label="开始时间" value={since} onValueChange={setSince} />
              </div>
              <p className="console-text-body">
                插件 <InlineCode>@zhin.js/plugin-rss</InlineCode> 的 RPC <InlineCode>rss.status</InlineCode>，
                订阅 ID <InlineCode tone="plain">feed_01J9</InlineCode>
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2"><Checkbox defaultChecked /> 启用</label>
                <label className="inline-flex items-center gap-2"><Switch defaultChecked /> 自动推送</label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>默认</Badge>
                <Badge variant="secondary">次要</Badge>
                <StatusBadge status="ok">运行中</StatusBadge>
                <StatusBadge status="info">同步中</StatusBadge>
                <StatusBadge status="warning">待处理</StatusBadge>
                <StatusBadge status="error">异常</StatusBadge>
              </div>
            </CardContent>
          </Card>
        </Grid>
        <Section title="订阅" description="窄于 40rem 的容器里，表格的每一行变成一张卡片；宽屏下详情在右侧。">
          <Tabs defaultValue="feeds">
            <TabsList>
              <TabsTrigger value="feeds">订阅</TabsTrigger>
              <TabsTrigger value="logs">日志</TabsTrigger>
            </TabsList>
            <TabsContent value="feeds">
              <ListDetail
                list={<Card><FeedTable onOpen={setSelected} /></Card>}
                detail={selectedFeed ? <Card><CardContent>{selectedFeed.name} · {selectedFeed.items} 条</CardContent></Card> : null}
                detailTitle={selectedFeed?.name}
                onDetailClose={() => setSelected(null)}
              />
            </TabsContent>
            <TabsContent value="logs"><EmptyState icon={Inbox} title="没有日志" compact /></TabsContent>
          </Tabs>
        </Section>
        <Grid min="20rem">
          <div className="grid gap-3">
            <Alert>
              <AlertTitle>提示</AlertTitle>
              <AlertDescription>配置已保存，重启后生效。</AlertDescription>
            </Alert>
            <ErrorAlert error="读取订阅失败" onRetry={noop} technicalDetail="HTTP 502" />
          </div>
          <Card><EmptyState icon={Inbox} title="没有记录" /></Card>
        </Grid>
        <Section title="空状态" description="64px 线稿插画 + 一句说明 + 可选的一个操作；插画是 brand-text 单色、1.5px 描边。">
          <Grid min="14rem">
            {EMPTY_ILLUSTRATIONS.map(name => (
              <Card key={name} data-illustration-card={name}>
                <EmptyState
                  illustration={name}
                  action={name === 'tasks' ? { label: '新建定时任务', variant: 'primary', onSelect: noop } : name === 'not-found' ? { label: '返回首页', href: '#' } : undefined}
                />
              </Card>
            ))}
          </Grid>
        </Section>
        <PageChromeProvider store={chrome}>
          <PluginContent />
        </PageChromeProvider>
      </PageShell>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="删除订阅数据？"
        description="删除后无法恢复。"
        variant="destructive"
        confirmText="zhin-feed"
        confirmLabel="删除"
        onConfirm={noop}
      />
    </ConsoleUiI18nProvider>
  )
}

createRoot(document.getElementById('root') ?? document.body).render(<Gallery />)
