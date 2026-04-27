import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Bot, AlertCircle, Wifi, WifiOff, Activity, Package, Zap, ChevronRight, RefreshCw } from 'lucide-react'
import { useWebSocket } from '@zhin.js/client'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'

interface BotInfo {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
  pendingRequestCount?: number
  pendingNoticeCount?: number
}

export default function BotManagePage() {
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { connected, sendRequest } = useWebSocket()

  const fetchBots = useCallback(async () => {
    if (!connected) {
      setLoading(false)
      setError('WebSocket 未连接，请刷新页面')
      return
    }
    try {
      const data = await sendRequest<{ bots: BotInfo[] }>({ type: 'bot:list' })
      setBots(data.bots || [])
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
      fetchBots()
    }
  }, [connected, fetchBots])

  useEffect(() => {
    if (!connected) return
    const interval = setInterval(fetchBots, 8000)
    return () => clearInterval(interval)
  }, [connected, fetchBots])

  if (loading && connected) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载失败: {error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">机器人管理</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">共 {bots.length} 个机器人，</span>
            <Badge variant="success">{bots.filter(b => b.connected).length}</Badge>
            <span className="text-sm text-muted-foreground">个在线</span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            ICQQ 扫码/验证码登录请前往侧栏{' '}
            <Link to="/icqq" className="text-primary underline-offset-4 hover:underline font-medium">
              ICQQ 管理
            </Link>
            。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); void fetchBots(); }} disabled={!connected || loading}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          刷新
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {bots.map((bot, index) => (
          <Link
            key={`${bot.adapter}-${bot.name}-${index}`}
            to={`/bots/${encodeURIComponent(bot.adapter)}/${encodeURIComponent(bot.name)}`}
            className="block transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          >
            <Card className="h-full cursor-pointer hover:border-primary/40">
              <CardContent className="p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-md ${bot.connected ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-muted'}`}>
                      <Bot className={`w-5 h-5 ${bot.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
                    </div>
                    <span className="text-lg font-bold">{bot.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={bot.connected ? 'success' : 'secondary'}>
                      {bot.connected ? <><Wifi className="w-3 h-3 mr-1" />在线</> : <><WifiOff className="w-3 h-3 mr-1" />离线</>}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">适配器:</span>
                  <Badge variant="outline">{bot.adapter}</Badge>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className={`w-4 h-4 ${bot.status === 'online' ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                      <span className="text-muted-foreground">运行状态</span>
                    </div>
                    <Badge variant={bot.status === 'online' ? 'success' : 'secondary'}>
                      {bot.status === 'online' ? '运行中' : '已停止'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                    <div className="flex items-center gap-2 text-sm">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">适配器类型</span>
                    </div>
                    <span className="text-sm font-medium">{bot.adapter}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                    <div className="flex items-center gap-2 text-sm">
                      <Zap className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">连接状态</span>
                    </div>
                    <span className={`text-sm font-medium ${bot.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                      {bot.connected ? '已连接' : '未连接'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  {(bot.pendingRequestCount ?? 0) + (bot.pendingNoticeCount ?? 0) > 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      {(bot.pendingRequestCount ?? 0) + (bot.pendingNoticeCount ?? 0)} 条待处理
                    </span>
                  )}
                  <p className="text-xs text-primary">点击进入管理</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {bots.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Bot className="w-16 h-16 text-muted-foreground/30" />
            <div className="text-center">
              <h3 className="text-lg font-semibold">暂无机器人</h3>
              <p className="text-sm text-muted-foreground">请先配置并启动机器人</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
