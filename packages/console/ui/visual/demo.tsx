/**
 * Component gallery for the visual regression cases (visual/console-ui.spec.ts).
 * Only package components and package CSS are used: layout below uses inline styles, because
 * dist/styles.css contains just the classes the components themselves use.
 */
import { useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, Inbox, Users } from 'lucide-react'
import {
  Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Checkbox, ConfirmDialog, ConsoleUiI18nProvider, EmptyState, ErrorAlert, Input, PageChromeActions,
  PageChromeProvider, PageHeader, PageShell, SearchableSelectField, SelectField, StatCard, StatGrid, Switch,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger,
  Textarea, createPageChromeStore, usePageChrome,
} from '../client/index.js'

const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const locale = params.get('locale') ?? 'zh-CN'
document.documentElement.classList.toggle('dark', theme === 'dark')
document.documentElement.lang = locale

/** Fixed clock so 「更新于 hh:mm:ss」 is stable in screenshots. */
const UPDATED_AT = new Date(2026, 10, 15, 9, 30, 15)

const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.25rem' }

function PluginContent() {
  const [model, setModel] = useState('gpt')
  usePageChrome({
    refresh: { onRefresh: () => undefined, updatedAt: UPDATED_AT },
    actions: <Button variant="destructive-outline">移除订阅</Button>,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>通过 usePageChrome 交给外壳的页头操作</CardTitle>
        <CardDescription>刷新控件和危险操作按钮由外壳摆放在页头。</CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ maxWidth: '20rem' }}>
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
        </div>
      </CardContent>
    </Card>
  )
}

function Gallery() {
  const [chrome] = useState(createPageChromeStore)
  const [mode, setMode] = useState('all')
  const [confirmOpen, setConfirmOpen] = useState(false)
  return (
    <ConsoleUiI18nProvider locale={locale}>
      <main style={{ maxWidth: 'var(--console-content-max)', margin: '0 auto', padding: 'var(--console-space-page-y) var(--console-space-page-x)' }}>
        <PageShell>
          <PageHeader
            title="组件示例"
            description="@zhin.js/console-ui 的按钮、输入框、下拉框、表格、对话框与页面外壳。"
            actions={<PageChromeActions store={chrome} />}
          />
          <StatGrid label="统计">
            <StatCard icon={Activity} label="消息" value="1,284" sub="过去 24 小时" />
            <StatCard icon={Users} label="会话" value="36" />
            <StatCard icon={Inbox} label="待处理" value="3" tone="warning" sub="需要处理" />
            <StatCard icon={Activity} label="错误" value="1" tone="danger" onOpen={() => undefined} />
          </StatGrid>
          <div style={grid}>
            <Card>
              <CardHeader>
                <CardTitle>按钮</CardTitle>
                <CardDescription>页面上的危险操作用描边样式，实心红色只在确认对话框里出现。</CardDescription>
              </CardHeader>
              <CardContent>
                <div style={row}>
                  <Button>主要操作</Button>
                  <Button variant="secondary">次要</Button>
                  <Button variant="outline">描边</Button>
                  <Button variant="ghost">幽灵</Button>
                  <Button variant="link">链接</Button>
                  <Button variant="destructive-outline" onClick={() => setConfirmOpen(true)}>删除数据</Button>
                  <Button variant="destructive">确认删除</Button>
                  <Button size="sm">小号</Button>
                  <Button disabled>禁用</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>输入</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <Input placeholder="订阅地址" defaultValue="https://example.com/feed.xml" />
                  <Input placeholder="未填写" aria-invalid="true" />
                  <SelectField
                    aria-label="筛选"
                    value={mode}
                    onValueChange={setMode}
                    options={[{ value: 'all', label: '全部' }, { value: 'active', label: '启用中' }, { value: 'paused', label: '已暂停' }]}
                  />
                  <Textarea placeholder="备注" rows={2} />
                  <div style={row}>
                    <Checkbox defaultChecked aria-label="启用" /> <span>启用</span>
                    <Switch defaultChecked aria-label="自动推送" /> <span>自动推送</span>
                    <Badge>默认</Badge>
                    <Badge variant="secondary">次要</Badge>
                    <Badge variant="success">正常</Badge>
                    <Badge variant="warning">警告</Badge>
                    <Badge variant="destructive">异常</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>表格</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="feeds">
                <TabsList>
                  <TabsTrigger value="feeds">订阅</TabsTrigger>
                  <TabsTrigger value="logs">日志</TabsTrigger>
                </TabsList>
                <TabsContent value="feeds">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>名称</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead numeric>条目</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow><TableCell>Zhin 发布</TableCell><TableCell>正常</TableCell><TableCell numeric>128</TableCell></TableRow>
                      <TableRow><TableCell>技术周刊</TableCell><TableCell><Badge variant="warning">拉取失败</Badge></TableCell><TableCell numeric>42</TableCell></TableRow>
                      <TableRow><TableCell>官方博客</TableCell><TableCell>正常</TableCell><TableCell numeric>7</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          <div style={grid}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <Alert>
                <AlertTitle>提示</AlertTitle>
                <AlertDescription>配置已保存，重启后生效。</AlertDescription>
              </Alert>
              <ErrorAlert error="读取订阅失败" onRetry={() => undefined} technicalDetail="HTTP 502" />
            </div>
            <Card><EmptyState icon={Inbox} title="没有记录" /></Card>
          </div>
          <PageChromeProvider store={chrome}>
            <PluginContent />
          </PageChromeProvider>
        </PageShell>
      </main>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="删除订阅数据？"
        description="删除后无法恢复。"
        variant="destructive"
        confirmText="zhin-feed"
        confirmLabel="删除"
        onConfirm={() => undefined}
      />
    </ConsoleUiI18nProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Gallery />)
