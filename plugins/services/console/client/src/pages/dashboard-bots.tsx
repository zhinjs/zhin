import { useEffect, useState } from 'react'
import { Bot, AlertCircle, Wifi, WifiOff, Activity, Package, Zap } from 'lucide-react'
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
}

export default function DashboardBots() {
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchBots()
    const interval = setInterval(fetchBots, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchBots = async () => {
    try {
      const res = await fetch('/api/bots', { credentials: 'include' })
      if (!res.ok) throw new Error('API 请求失败')
      const data = await res.json()
      if (data.success) { setBots(data.data); setError(null) }
      else throw new Error('数据格式错误')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">机器人管理</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-muted-foreground">共 {bots.length} 个机器人，</span>
          <Badge variant="success">{bots.filter(b => b.connected).length}</Badge>
          <span className="text-sm text-muted-foreground">个在线</span>
        </div>
      </div>

      <Separator />

      {/* Bot grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {bots.map((bot, index) => (
          <Card key={`${bot.adapter}-${bot.name}-${index}`}>
            <CardContent className="p-5 space-y-4">
              {/* Header */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-md ${bot.connected ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-muted'}`}>
                    <Bot className={`w-5 h-5 ${bot.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
                  </div>
                  <span className="text-lg font-bold">{bot.name}</span>
                </div>
                <div className="relative">
                  <Badge variant={bot.connected ? 'success' : 'secondary'}>
                    {bot.connected ? <><Wifi className="w-3 h-3 mr-1" />在线</> : <><WifiOff className="w-3 h-3 mr-1" />离线</>}
                  </Badge>
                </div>
              </div>

              {/* Adapter */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">适配器:</span>
                <Badge variant="outline">{bot.adapter}</Badge>
              </div>

              <Separator />

              {/* Details */}
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
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty state */}
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
