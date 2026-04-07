import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Search, Package, Download, ExternalLink, AlertCircle,
  ArrowUpDown, RefreshCw, ShieldCheck, Globe,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'

interface MarketPlugin {
  name: string
  version: string
  description: string
  author: string
  isOfficial: boolean
  keywords: string[]
  npm: string
  date: string
}

interface PluginDetail {
  name: string
  version: string
  description: string
  license: string
  author: string
  homepage: string
  repository: string
  keywords: string[]
  engines: Record<string, string>
  peerDependencies: Record<string, string>
  downloads: { weekly: number; monthly: number }
  readme: string
  versions: string[]
  lastPublish: string
}

interface UpdateInfo {
  name: string
  current: string
  latest: string
}

type SortKey = 'name' | 'date'
type Category = '' | 'adapter' | 'service' | 'util' | 'game' | 'feature'

const CATEGORIES: { value: Category; label: string; icon: LucideIcon }[] = [
  { value: '', label: '全部', icon: Package },
  { value: 'adapter', label: '适配器', icon: Globe },
  { value: 'service', label: '服务', icon: ShieldCheck },
  { value: 'util', label: '工具', icon: Package },
  { value: 'game', label: '游戏', icon: Package },
  { value: 'feature', label: '特性', icon: Package },
]

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

function formatDownloads(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export default function MarketplacePage() {
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('')
  const [officialOnly, setOfficialOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [updates, setUpdates] = useState<UpdateInfo[]>([])
  const [updatesLoading, setUpdatesLoading] = useState(false)

  // Detail dialog
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<PluginDetail | null>(null)

  const fetchPlugins = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (category) params.set('category', category)
      if (officialOnly) params.set('official', 'true')
      params.set('limit', '50')

      const res = await fetch(`/pub/marketplace/search?${params}`)
      if (!res.ok) throw new Error('搜索失败')
      const data = await res.json()
      if (data.success) {
        setPlugins(data.data)
      } else {
        throw new Error(data.error || '数据格式错误')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [search, category, officialOnly])

  useEffect(() => {
    fetchPlugins()
  }, [fetchPlugins])

  const checkUpdates = useCallback(async () => {
    setUpdatesLoading(true)
    try {
      const token = localStorage.getItem('zhin_api_token')
      const res = await fetch('/api/marketplace/updates', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) setUpdates(data.data)
      }
    } catch { /* ignore */ }
    finally { setUpdatesLoading(false) }
  }, [])

  const openDetail = useCallback(async (name: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/pub/marketplace/detail/${encodeURIComponent(name)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.success) setDetail(data.data)
      }
    } catch { /* ignore */ }
    finally { setDetailLoading(false) }
  }, [])

  const sorted = useMemo(() => {
    const arr = [...plugins]
    if (sortKey === 'date') {
      arr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    } else {
      arr.sort((a, b) => a.name.localeCompare(b.name))
    }
    return arr
  }, [plugins, sortKey])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">插件市场</h1>
          <p className="text-sm text-muted-foreground mt-1">
            探索 Zhin.js 生态中的 {plugins.length} 个插件
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkUpdates}
            disabled={updatesLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${updatesLoading ? 'animate-spin' : ''}`} />
            检查更新
          </Button>
        </div>
      </div>

      {/* Updates banner */}
      {updates.length > 0 && (
        <Alert>
          <RefreshCw className="h-4 w-4" />
          <AlertDescription>
            有 {updates.length} 个插件可更新：
            {updates.map(u => (
              <Badge key={u.name} variant="secondary" className="ml-1">
                {u.name} {u.current} → {u.latest}
              </Badge>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索插件名称、描述..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={officialOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setOfficialOnly(!officialOnly)}
          >
            <ShieldCheck className="w-4 h-4 mr-1" />
            仅官方
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortKey(sortKey === 'name' ? 'date' : 'name')}
          >
            <ArrowUpDown className="w-4 h-4 mr-1" />
            {sortKey === 'name' ? '名称' : '更新时间'}
          </Button>
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={category} onValueChange={v => setCategory(v as Category)}>
        <TabsList>
          {CATEGORIES.map(c => (
            <TabsTrigger key={c.value} value={c.value}>
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      )}

      {/* Plugin Grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map(plugin => (
            <Card
              key={plugin.name}
              className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
              onClick={() => openDetail(plugin.name)}
            >
              <CardContent className="p-4 space-y-3">
                {/* Name & Badge */}
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="font-semibold text-sm truncate">{plugin.name}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {plugin.isOfficial && (
                      <Badge variant="default" className="text-[10px]">官方</Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">v{plugin.version}</Badge>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2">
                  {plugin.description || '暂无描述'}
                </p>

                <Separator />

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{plugin.author}</span>
                  <span>{formatDate(plugin.date)}</span>
                </div>

                {/* Keywords */}
                {plugin.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {plugin.keywords.slice(0, 4).map(kw => (
                      <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0">
                        {kw}
                      </Badge>
                    ))}
                    {plugin.keywords.length > 4 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        +{plugin.keywords.length - 4}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && sorted.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Package className="w-12 h-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">未找到插件</h3>
            <p className="text-sm text-muted-foreground">尝试调整搜索条件或分类筛选</p>
          </CardContent>
        </Card>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          {detailLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  {detail.name}
                  <Badge variant="secondary">v{detail.version}</Badge>
                </DialogTitle>
                <DialogDescription>{detail.description}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{formatDownloads(detail.downloads.weekly)}</div>
                    <div className="text-[10px] text-muted-foreground">周下载</div>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{formatDownloads(detail.downloads.monthly)}</div>
                    <div className="text-[10px] text-muted-foreground">月下载</div>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{detail.versions.length}</div>
                    <div className="text-[10px] text-muted-foreground">版本数</div>
                  </div>
                </div>

                <Separator />

                {/* Metadata */}
                <div className="space-y-2 text-sm">
                  {detail.author && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">作者</span>
                      <span>{detail.author}</span>
                    </div>
                  )}
                  {detail.license && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">许可证</span>
                      <span>{detail.license}</span>
                    </div>
                  )}
                  {detail.lastPublish && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">最后发布</span>
                      <span>{formatDate(detail.lastPublish)}</span>
                    </div>
                  )}
                  {detail.engines && Object.keys(detail.engines).length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Node.js</span>
                      <span>{detail.engines.node || '-'}</span>
                    </div>
                  )}
                </div>

                {/* Peer Dependencies */}
                {detail.peerDependencies && Object.keys(detail.peerDependencies).length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium mb-2">对等依赖</h4>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(detail.peerDependencies).map(([name, ver]) => (
                          <Badge key={name} variant="outline" className="text-xs">
                            {name}@{ver}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* README excerpt */}
                {detail.readme && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium mb-2">README</h4>
                      <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                        {detail.readme}
                      </p>
                    </div>
                  </>
                )}

                {/* Install command */}
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">安装命令</h4>
                  <code className="block text-xs bg-secondary rounded-md p-2">
                    pnpm add {detail.name}
                  </code>
                </div>
              </div>

              <DialogFooter className="gap-2">
                {detail.homepage && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detail.homepage} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3 mr-1" /> 主页
                    </a>
                  </Button>
                )}
                {detail.npm || (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`https://www.npmjs.com/package/${detail.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="w-3 h-3 mr-1" /> npm
                    </a>
                  </Button>
                )}
                <DialogClose asChild>
                  <Button variant="secondary" size="sm">关闭</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>加载插件详情失败</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
