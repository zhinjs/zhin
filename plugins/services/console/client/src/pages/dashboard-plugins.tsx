import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertCircle, Package, Terminal, Box as IconBox, Layers, Clock, Brain, Wrench, Database, Shield, Settings, Plug, Server, type LucideIcon } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'

/** Feature 序列化格式（与后端 FeatureJSON 一致） */
interface FeatureJSON {
  name: string
  icon: string
  desc: string
  count: number
  items: any[]
}

interface Plugin {
  name: string
  status: 'active' | 'inactive'
  description: string
  features: FeatureJSON[]
}

/** 根据后端返回的 icon 名称映射到 lucide-react 图标组件 */
const iconMap: Record<string, LucideIcon> = {
  Terminal,
  Box: IconBox,
  Layers,
  Clock,
  Brain,
  Wrench,
  Database,
  Shield,
  Settings,
  Plug,
  Server,
}

function getIcon(iconName: string): LucideIcon {
  return iconMap[iconName] || Package
}

export default function DashboardPlugins() {
  const navigate = useNavigate()
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPlugins()
    const interval = setInterval(fetchPlugins, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchPlugins = async () => {
    try {
      const res = await apiFetch('/api/plugins')
      if (!res.ok) throw new Error('API 请求失败')
      const data = await res.json()
      if (data.success) { setPlugins(data.data); setError(null) }
      else throw new Error('数据格式错误')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
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
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">插件管理</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-muted-foreground">共 {plugins.length} 个插件</span>
          <Badge variant="success">{plugins.filter(p => p.status === 'active').length}</Badge>
          <span className="text-sm text-muted-foreground">个运行中</span>
        </div>
      </div>

      {/* Plugin grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {plugins.map((plugin, index) => (
          <Card
            key={`${plugin.name}-${index}`}
            className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
            onClick={() => navigate(`/plugins/${encodeURIComponent(plugin.name)}`)}
          >
            <CardContent className="p-4 space-y-3">
              {/* Header */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-secondary">
                    <Package className="w-4 h-4" />
                  </div>
                  <span className="font-semibold text-sm">{plugin.name}</span>
                </div>
                <Badge variant={plugin.status === 'active' ? 'success' : 'secondary'}>
                  {plugin.status === 'active' ? '运行中' : '已停止'}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground line-clamp-2">
                {plugin.description || '暂无描述'}
              </p>

              <Separator />

              {/* Features - 动态渲染，每个 Feature 自带 icon/name/count */}
              {plugin.features.length > 0 ? (
                <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${Math.min(plugin.features.length, 4)}, 1fr)` }}>
                  {plugin.features.map((feature) => {
                    const Icon = getIcon(feature.icon)
                    return (
                      <div key={feature.name} className="flex flex-col items-center gap-0.5 rounded-md bg-secondary/50 p-1.5">
                        <Icon className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm font-bold">{feature.count}</span>
                        <span className="text-[10px] text-muted-foreground">{feature.desc}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-1">无注册功能</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty state */}
      {plugins.length === 0 && (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
              <Package className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">暂无插件</h3>
            <p className="text-sm text-muted-foreground">请先安装并启用插件</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
