import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bot, AlertCircle, Activity, Package, Clock, Cpu, MemoryStick, FileText, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'

interface Stats {
  plugins: { total: number; active: number }
  bots: { total: number; online: number }
  commands: number
  components: number
  uptime: number
  memory: number
}

interface SystemStatus {
  uptime: number
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number }
  cpu: { user: number; system: number }
  platform: string
  nodeVersion: string
}

export default function DashboardHome() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchData = async () => {
    try {
      const [statsRes, statusRes] = await Promise.all([
        fetch('/api/stats', { credentials: 'include' }),
        fetch('/api/system/status', { credentials: 'include' })
      ])
      if (!statsRes.ok || !statusRes.ok) throw new Error('API 请求失败')
      const statsData = await statsRes.json()
      const statusData = await statusRes.json()
      if (statsData.success && statusData.success) {
        setStats(statsData.data)
        setSystemStatus(statusData.data)
        setError(null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${days}天 ${hours}小时 ${minutes}分钟`
  }

  const formatMemory = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

  if (loading) {
    return (
      <div className="space-y-6">
        <div><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-64 mt-2" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
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
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">系统概览</h1>
        <p className="text-muted-foreground">实时监控您的机器人框架运行状态</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">插件总数</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.plugins.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <Badge variant="secondary" className="mr-1">{stats?.plugins.active || 0}</Badge>个活跃
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">机器人</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.bots.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <Badge variant="success" className="mr-1">{stats?.bots.online || 0}</Badge>个在线
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">命令数量</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.commands || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">可用命令</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">组件数量</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.components || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">已注册组件</p>
          </CardContent>
        </Card>
      </div>

      {/* System status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>系统信息</CardTitle>
            <CardDescription>服务器运行状态</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm"><Clock className="h-4 w-4 text-muted-foreground" />运行时间</div>
              <Badge variant="secondary">{systemStatus ? formatUptime(systemStatus.uptime) : '-'}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm"><Cpu className="h-4 w-4 text-muted-foreground" />平台</div>
              <Badge variant="secondary">{systemStatus?.platform || '-'}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-muted-foreground" />Node 版本</div>
              <Badge variant="secondary">{systemStatus?.nodeVersion || '-'}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>资源使用</CardTitle>
            <CardDescription>内存使用情况</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm"><MemoryStick className="h-4 w-4 text-muted-foreground" />堆内存使用</div>
              <Badge variant="secondary">{stats ? `${stats.memory.toFixed(2)} MB` : '-'}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm"><MemoryStick className="h-4 w-4 text-muted-foreground" />总堆内存</div>
              <Badge variant="secondary">{systemStatus ? formatMemory(systemStatus.memory.heapTotal) : '-'}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm"><MemoryStick className="h-4 w-4 text-muted-foreground" />RSS</div>
              <Badge variant="secondary">{systemStatus ? formatMemory(systemStatus.memory.rss) : '-'}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle>快速操作</CardTitle>
          <CardDescription>常用功能快捷入口</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button variant="outline" className="h-auto p-4 justify-start" onClick={() => navigate('/plugins')}>
              <div className="flex flex-col items-start gap-1">
                <Package className="h-5 w-5 mb-1" />
                <span className="font-medium">插件管理</span>
                <span className="text-xs text-muted-foreground">查看和管理插件</span>
              </div>
            </Button>
            <Button variant="outline" className="h-auto p-4 justify-start" onClick={() => navigate('/bots')}>
              <div className="flex flex-col items-start gap-1">
                <Bot className="h-5 w-5 mb-1" />
                <span className="font-medium">机器人状态</span>
                <span className="text-xs text-muted-foreground">监控机器人运行</span>
              </div>
            </Button>
            <Button variant="outline" className="h-auto p-4 justify-start" onClick={() => navigate('/logs')}>
              <div className="flex flex-col items-start gap-1">
                <FileText className="h-5 w-5 mb-1" />
                <span className="font-medium">系统日志</span>
                <span className="text-xs text-muted-foreground">查看运行日志</span>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
