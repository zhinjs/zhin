import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { ArrowLeft, AlertCircle, Package, Terminal, Box as IconBox, Layers, Clock, Database, Brain, Wrench, Shield, Settings, Plug, Server, type LucideIcon } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { PluginConfigForm } from '../components/PluginConfigForm'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
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

interface PluginDetail {
  name: string
  filename: string
  status: 'active' | 'inactive'
  description: string
  features: FeatureJSON[]
  contexts: Array<{ name: string }>
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

export default function DashboardPluginDetail() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [plugin, setPlugin] = useState<PluginDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (name) fetchPluginDetail(name)
  }, [name])

  const fetchPluginDetail = async (pluginName: string) => {
    try {
      const res = await apiFetch(`/api/plugins/${encodeURIComponent(pluginName)}`)
      if (!res.ok) throw new Error('API 请求失败')
      const data = await res.json()
      if (data.success) { setPlugin(data.data); setError(null) }
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
        <Skeleton className="h-8 w-24" />
        <div className="flex items-center gap-3"><Skeleton className="h-12 w-12 rounded-xl" /><div><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64 mt-1" /></div></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      </div>
    )
  }

  if (error || !plugin) {
    return (
      <div>
        <Button variant="ghost" onClick={() => navigate('/plugins')} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载失败: {error || '插件不存在'}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Button variant="ghost" size="sm" onClick={() => navigate('/plugins')}>
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回
      </Button>

      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-secondary">
          <Package className="w-6 h-6" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{plugin.name}</h1>
            <Badge variant={plugin.status === 'active' ? 'success' : 'secondary'}>
              {plugin.status === 'active' ? '运行中' : '已停止'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{plugin.description || '暂无描述'}</p>
        </div>
      </div>

      {/* Config form */}
      <PluginConfigForm pluginName={plugin.name} onSuccess={() => {}} />

      <Separator />

      {/* Stats grid - 动态渲染 features 摘要 */}
      {plugin.features.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {plugin.features.map((feature) => {
            const Icon = getIcon(feature.icon)
            return (
              <Card key={feature.name}>
                <CardContent className="flex flex-col items-center gap-1 p-3">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-2xl font-bold">{feature.count}</span>
                  <span className="text-xs text-muted-foreground">{feature.desc}</span>
                </CardContent>
              </Card>
            )
          })}
          {/* Contexts card */}
          {plugin.contexts.length > 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-1 p-3">
                <Database className="w-4 h-4 text-muted-foreground" />
                <span className="text-2xl font-bold">{plugin.contexts.length}</span>
                <span className="text-xs text-muted-foreground">上下文</span>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Detail sections - 动态渲染每个 Feature 的 items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {plugin.features.map((feature) => {
          if (feature.items.length === 0) return null
          const Icon = getIcon(feature.icon)

          return (
            <Card key={feature.name}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-base">{feature.desc}</CardTitle>
                  <Badge variant="secondary">{feature.count}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
                  {feature.items.map((item, index) => (
                    <FeatureItemCard key={index} featureName={feature.name} item={item} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}

        {/* Contexts section */}
        {plugin.contexts.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">上下文</CardTitle>
                <Badge variant="secondary">{plugin.contexts.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
                {plugin.contexts.map((ctx, index) => (
                  <div key={index} className="rounded-md bg-muted/50 p-2">
                    <code className="text-sm">{ctx.name}</code>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

/** 根据 Feature 类型渲染不同样式的 item 卡片 */
function FeatureItemCard({ featureName, item }: { featureName: string; item: any }) {
  switch (featureName) {
    case 'command':
      return (
        <div className="rounded-md bg-muted/50 p-3 space-y-1">
          <code className="text-sm font-semibold">{item.name}</code>
          {item.desc?.map((desc: string, i: number) => (
            <p key={i} className="text-xs text-muted-foreground">{desc}</p>
          ))}
          {item.usage && item.usage.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">用法:</span>
              {item.usage.map((u: string, i: number) => (
                <code key={i} className="block text-xs bg-muted rounded px-1 py-0.5 mt-0.5">{u}</code>
              ))}
            </div>
          )}
          {item.examples && item.examples.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">示例:</span>
              {item.examples.map((e: string, i: number) => (
                <code key={i} className="block text-xs bg-muted rounded px-1 py-0.5 mt-0.5">{e}</code>
              ))}
            </div>
          )}
        </div>
      )
    case 'cron':
      return (
        <div className="flex justify-between items-center rounded-md bg-muted/50 p-2">
          <code className="text-sm">{item.expression}</code>
          <Badge variant={item.running ? 'success' : 'secondary'}>
            {item.running ? '运行中' : '已停止'}
          </Badge>
        </div>
      )
    case 'tool':
      return (
        <div className="rounded-md bg-muted/50 p-3 space-y-1">
          <code className="text-sm font-semibold">{item.name}</code>
          {item.desc && <p className="text-xs text-muted-foreground">{item.desc}</p>}
          {item.platforms && item.platforms.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {item.platforms.map((p: string, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>
              ))}
            </div>
          )}
        </div>
      )
    case 'skill':
      return (
        <div className="rounded-md bg-muted/50 p-3 space-y-1">
          <code className="text-sm font-semibold">{item.name}</code>
          {item.desc && <p className="text-xs text-muted-foreground">{item.desc}</p>}
          {item.toolCount != null && (
            <span className="text-xs text-muted-foreground">工具: {item.toolCount}</span>
          )}
        </div>
      )
    case 'config':
      return (
        <div className="flex justify-between items-center rounded-md bg-muted/50 p-2">
          <code className="text-sm">{item.name}</code>
          {item.defaultValue !== undefined && (
            <span className="text-xs text-muted-foreground">默认: {JSON.stringify(item.defaultValue)}</span>
          )}
        </div>
      )
    case 'permission':
      return (
        <div className="rounded-md bg-muted/50 p-2">
          <code className="text-sm">{item.name}</code>
        </div>
      )
    case 'database':
      return (
        <div className="rounded-md bg-muted/50 p-2">
          <code className="text-sm">{item.name}</code>
        </div>
      )
    case 'adapter':
      return (
        <div className="rounded-md bg-muted/50 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Plug className="w-3.5 h-3.5 text-muted-foreground" />
            <code className="text-sm font-semibold">{item.name}</code>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>Bot: {item.bots ?? 0}</span>
            <span>在线: {item.online ?? 0}</span>
            {item.tools > 0 && <span>工具: {item.tools}</span>}
          </div>
        </div>
      )
    case 'service':
      return (
        <div className="rounded-md bg-muted/50 p-2 flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-muted-foreground" />
          <code className="text-sm">{item.name}</code>
          {item.desc && item.desc !== item.name && (
            <span className="text-xs text-muted-foreground">- {item.desc}</span>
          )}
        </div>
      )
    default:
      // 通用渲染：显示 item.name 或 JSON
      return (
        <div className="rounded-md bg-muted/50 p-2">
          <code className="text-sm">{item.name || JSON.stringify(item)}</code>
        </div>
      )
  }
}
