import { useEffect, useState, useCallback, type ChangeEvent } from 'react'
import { Clock, Plus, Trash2, AlertCircle, Pause, Play, RefreshCw, Timer, Cpu, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { useWebSocket, useSelector, selectConfigConnected } from '@zhin.js/client'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Separator } from '../components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'

interface MemoryCron {
  type: 'memory'
  expression: string
  running: boolean
  nextExecution: string | null
  plugin: string
}

interface CronJobContext {
  platform?: string
  botId?: string
  senderId?: string
  sceneId?: string
  scope?: string
}

interface PersistentCron {
  type: 'persistent'
  id: string
  cronExpression: string
  prompt: string
  label?: string
  enabled: boolean
  context?: CronJobContext
  createdAt: number
}

interface BotInfo {
  name: string
  adapter: string
  connected: boolean
}

const EMPTY_CONTEXT: CronJobContext = { platform: '', botId: '', senderId: '', sceneId: '', scope: '' }

export default function CronPage() {
  const [memoryCrons, setMemoryCrons] = useState<MemoryCron[]>([])
  const [persistentCrons, setPersistentCrons] = useState<PersistentCron[]>([])
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PersistentCron | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [newCron, setNewCron] = useState({ cronExpression: '', prompt: '', label: '', context: { ...EMPTY_CONTEXT } })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedMemIdx, setExpandedMemIdx] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const connected = useSelector(selectConfigConnected)
  const { sendRequest } = useWebSocket()

  const fetchCrons = useCallback(async () => {
    if (!connected) {
      setLoading(false)
      setError('WebSocket 未连接，请刷新页面')
      return
    }
    try {
      const data = await sendRequest<{ memory: MemoryCron[]; persistent: PersistentCron[] }>({ type: 'cron:list' })
      setMemoryCrons(data.memory || [])
      setPersistentCrons(data.persistent || [])
      // Also fetch bots for context selector
      try {
        const botData = await sendRequest<{ bots: BotInfo[] }>({ type: 'bot:list' })
        setBots(botData.bots || [])
      } catch { /* ignore */ }
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [connected, sendRequest])

  useEffect(() => {
    if (connected) {
      setLoading(true)
      fetchCrons()
    }
  }, [connected, fetchCrons])

  const handleAdd = async () => {
    if (!newCron.cronExpression || !newCron.prompt) return
    setSubmitting(true)
    try {
      // Build context, omitting empty fields
      const ctx: CronJobContext = {}
      if (newCron.context.platform) ctx.platform = newCron.context.platform
      if (newCron.context.botId) ctx.botId = newCron.context.botId
      if (newCron.context.senderId) ctx.senderId = newCron.context.senderId
      if (newCron.context.sceneId) ctx.sceneId = newCron.context.sceneId
      if (newCron.context.scope) ctx.scope = newCron.context.scope
      const hasContext = Object.keys(ctx).length > 0
      await sendRequest({
        type: 'cron:add',
        cronExpression: newCron.cronExpression,
        prompt: newCron.prompt,
        label: newCron.label,
        context: hasContext ? ctx : undefined,
      })
      setAddDialogOpen(false)
      setNewCron({ cronExpression: '', prompt: '', label: '', context: { ...EMPTY_CONTEXT } })
      await fetchCrons()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await sendRequest({ type: 'cron:remove', id: deleteTarget.id })
      setDeleteTarget(null)
      await fetchCrons()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (job: PersistentCron) => {
    try {
      if (job.enabled) {
        await sendRequest({ type: 'cron:pause', id: job.id })
      } else {
        await sendRequest({ type: 'cron:resume', id: job.id })
      }
      await fetchCrons()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (loading && connected) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchCrons() }}>
          <RefreshCw className="w-4 h-4 mr-1" /> 重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">定时任务</h2>
          <p className="text-muted-foreground text-sm mt-1">
            管理持久化定时任务和查看插件注册的内存任务
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchCrons() }}>
            <RefreshCw className="w-4 h-4 mr-1" /> 刷新
          </Button>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> 新建任务
          </Button>
        </div>
      </div>

      {/* Persistent Cron Jobs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Timer className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">持久化任务</h3>
          <Badge variant="secondary">{persistentCrons.length}</Badge>
        </div>
        {persistentCrons.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>暂无持久化定时任务</p>
              <p className="text-xs mt-1">点击「新建任务」添加一个定时 AI 任务</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {persistentCrons.map((job) => {
              const isExpanded = expandedId === job.id
              return (
              <Card key={job.id} className={!job.enabled ? 'opacity-60' : ''}>
                <CardContent className="py-4">
                  <div
                    className="flex items-start justify-between gap-4 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : job.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                        <span className="font-medium truncate">
                          {job.label || job.id}
                        </span>
                        <Badge variant={job.enabled ? 'default' : 'outline'} className="text-xs shrink-0">
                          {job.enabled ? '运行中' : '已暂停'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2 ml-6">
                        <code className="bg-muted px-1.5 py-0.5 rounded">{job.cronExpression}</code>
                        <span>创建于 {new Date(job.createdAt).toLocaleString()}</span>
                      </div>
                      {!isExpanded && (
                        <p className="text-sm text-muted-foreground line-clamp-1 ml-6">{job.prompt}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={job.enabled ? '暂停' : '恢复'}
                        onClick={() => handleToggle(job)}
                      >
                        {job.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="删除"
                        onClick={() => setDeleteTarget(job)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-6 space-y-3 border-t pt-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-muted-foreground">任务 ID</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="复制 ID"
                            onClick={() => {
                              navigator.clipboard.writeText(job.id)
                              setCopiedId(job.id)
                              setTimeout(() => setCopiedId(null), 1500)
                            }}
                          >
                            {copiedId === job.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                        <code className="text-xs bg-muted px-2 py-1 rounded block">{job.id}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">Cron 表达式</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded block">{job.cronExpression}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">Prompt</span>
                        <pre className="text-sm bg-muted px-3 py-2 rounded whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{job.prompt}</pre>
                      </div>
                      {job.context && Object.values(job.context).some(Boolean) && (
                        <div>
                          <span className="text-xs font-medium text-muted-foreground block mb-1">执行上下文</span>
                          <div className="bg-muted px-3 py-2 rounded text-xs space-y-1">
                            {job.context.platform && <p><span className="text-muted-foreground">平台:</span> {job.context.platform}</p>}
                            {job.context.botId && <p><span className="text-muted-foreground">Bot:</span> {job.context.botId}</p>}
                            {job.context.senderId && <p><span className="text-muted-foreground">发送者:</span> {job.context.senderId}</p>}
                            {job.context.sceneId && <p><span className="text-muted-foreground">场景:</span> {job.context.sceneId}</p>}
                            {job.context.scope && <p><span className="text-muted-foreground">类型:</span> {job.context.scope}</p>}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>状态: {job.enabled ? '✅ 运行中' : '⏸️ 已暂停'}</span>
                        <span>创建于: {new Date(job.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              )
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* Memory Cron Jobs (read-only) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">内存任务（插件注册）</h3>
          <Badge variant="outline">{memoryCrons.length}</Badge>
        </div>
        {memoryCrons.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              暂无插件注册的内存定时任务
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {memoryCrons.map((cron, idx) => {
              const isExpanded = expandedMemIdx === idx
              return (
              <Card key={idx} className={!cron.running ? 'opacity-60' : ''}>
                <CardContent className="py-3">
                  <div
                    className="flex items-center justify-between mb-1 cursor-pointer"
                    onClick={() => setExpandedMemIdx(isExpanded ? null : idx)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                      <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{cron.expression}</code>
                    </div>
                    <Badge variant={cron.running ? 'default' : 'outline'} className="text-xs">
                      {cron.running ? '运行中' : '已停止'}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5 ml-6">
                    <p>插件: {cron.plugin}</p>
                    {cron.nextExecution && (
                      <p>下次执行: {new Date(cron.nextExecution).toLocaleString()}</p>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-6 space-y-2 border-t pt-3">
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">Cron 表达式</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded block">{cron.expression}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">所属插件</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded block">{cron.plugin}</code>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>状态: {cron.running ? '✅ 运行中' : '⏹️ 已停止'}</span>
                        {cron.nextExecution && (
                          <span>下次执行: {new Date(cron.nextExecution).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建定时任务</DialogTitle>
            <DialogDescription>
              创建一个持久化定时任务，到点时会将 Prompt 发送给 AI 执行。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">标签（可选）</label>
              <Input
                placeholder="例如：每日摘要"
                value={newCron.label}
                onChange={(e) => setNewCron((p) => ({ ...p, label: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Cron 表达式</label>
              <Input
                placeholder="分 时 日 月 周，例如：0 9 * * *"
                value={newCron.cronExpression}
                onChange={(e) => setNewCron((p) => ({ ...p, cronExpression: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                5 字段格式：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-7)
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Prompt</label>
              <Textarea
                placeholder="触发时发送给 AI 的指令..."
                rows={4}
                value={newCron.prompt}
                onChange={(e) => setNewCron((p) => ({ ...p, prompt: e.target.value }))}
              />
            </div>
            <Separator />
            <div>
              <label className="text-sm font-medium mb-1.5 block">执行上下文（可选）</label>
              <p className="text-xs text-muted-foreground mb-3">
                指定任务执行时的身份信息，如不填则以 system 身份执行
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">适配器</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={newCron.context.platform || ''}
                    onChange={(e) => {
                      const platform = e.target.value
                      setNewCron((p) => ({ ...p, context: { ...p.context, platform, botId: '' } }))
                    }}
                  >
                    <option value="">不指定</option>
                    {[...new Set(bots.map((b) => b.adapter))].map((adapter) => (
                      <option key={adapter} value={adapter}>{adapter}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Bot</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={newCron.context.botId || ''}
                    disabled={!newCron.context.platform}
                    onChange={(e) => setNewCron((p) => ({ ...p, context: { ...p.context, botId: e.target.value } }))}
                  >
                    <option value="">不指定</option>
                    {bots
                      .filter((b) => b.adapter === newCron.context.platform)
                      .map((b) => (
                        <option key={b.name} value={b.name}>{b.name}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">场景类型</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={newCron.context.scope || ''}
                    onChange={(e) => setNewCron((p) => ({ ...p, context: { ...p.context, scope: e.target.value } }))}
                  >
                    <option value="">不指定</option>
                    <option value="private">私聊 (private)</option>
                    <option value="group">群聊 (group)</option>
                    <option value="channel">频道 (channel)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">发送者 ID</label>
                  <Input
                    placeholder="用户 ID"
                    value={newCron.context.senderId || ''}
                    onChange={(e) => setNewCron((p) => ({ ...p, context: { ...p.context, senderId: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">场景 ID</label>
                  <Input
                    placeholder="群号/频道ID"
                    value={newCron.context.sceneId || ''}
                    onChange={(e) => setNewCron((p) => ({ ...p, context: { ...p.context, sceneId: e.target.value } }))}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button
              onClick={handleAdd}
              disabled={submitting || !newCron.cronExpression || !newCron.prompt}
            >
              {submitting ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除任务「{deleteTarget?.label || deleteTarget?.id}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
