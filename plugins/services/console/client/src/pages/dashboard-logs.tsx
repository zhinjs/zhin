import { useEffect, useState, useRef } from 'react'
import { Info, AlertTriangle, XCircle, Circle, Trash2, RefreshCw, FileText, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Checkbox } from '../components/ui/checkbox'
import { cn } from '@zhin.js/client'

interface LogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
  source: string
}

interface LogStats {
  total: number
  byLevel: Record<string, number>
  oldestTimestamp: string | null
}

export default function DashboardLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [prevLogCount, setPrevLogCount] = useState(0)

  useEffect(() => {
    fetchLogs()
    fetchStats()
    const interval = setInterval(() => { fetchLogs(); fetchStats() }, 3000)
    return () => clearInterval(interval)
  }, [levelFilter])

  useEffect(() => {
    if (autoScroll && logs.length > prevLogCount) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    setPrevLogCount(logs.length)
  }, [logs, autoScroll])

  const fetchLogs = async () => {
    try {
      const url = levelFilter === 'all' ? '/api/logs?limit=100' : `/api/logs?limit=100&level=${levelFilter}`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error('API 请求失败')
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) { setLogs(data.data.reverse()); setError(null) }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/logs/stats', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      if (data.success) setStats(data.data)
    } catch (err) { console.error('Failed to fetch stats:', err) }
  }

  const handleCleanup = async (days?: number, maxRecords?: number) => {
    const message = days ? `确定清理 ${days} 天前的日志吗？` : `确定只保留最近 ${maxRecords} 条日志吗？`
    if (!confirm(message)) return
    try {
      const res = await fetch('/api/logs/cleanup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, maxRecords }), credentials: 'include'
      })
      if (!res.ok) throw new Error('清理失败')
      const data = await res.json()
      if (data.success) { alert(`成功清理 ${data.data.deletedCount} 条日志`); fetchLogs(); fetchStats() }
    } catch (err) { alert((err as Error).message) }
  }

  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'info': return { border: 'border-l-blue-500', badge: 'default' as const, icon: <Info className="w-3 h-3" /> }
      case 'warn': return { border: 'border-l-amber-500', badge: 'warning' as const, icon: <AlertTriangle className="w-3 h-3" /> }
      case 'error': return { border: 'border-l-red-500', badge: 'destructive' as const, icon: <XCircle className="w-3 h-3" /> }
      default: return { border: 'border-l-gray-500', badge: 'secondary' as const, icon: <Circle className="w-3 h-3" /> }
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">系统日志</h1>
        <p className="text-sm text-muted-foreground">实时查看系统运行日志</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-1 p-4">
              <span className="text-2xl font-bold">{stats.total}</span>
              <span className="text-xs text-muted-foreground">总日志数</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-1 p-4">
              <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.byLevel.info || 0}</span>
              <span className="text-xs text-muted-foreground">Info</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-1 p-4">
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.byLevel.warn || 0}</span>
              <span className="text-xs text-muted-foreground">Warn</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-1 p-4">
              <span className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.byLevel.error || 0}</span>
              <span className="text-xs text-muted-foreground">Error</span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Toolbar */}
      <Card>
        <CardContent className="flex justify-between items-center p-3 flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="所有级别" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有级别</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-scroll"
                checked={autoScroll}
                onCheckedChange={(checked) => setAutoScroll(checked as boolean)}
              />
              <label htmlFor="auto-scroll" className="text-sm cursor-pointer">自动滚动</label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleCleanup(7)}>
              <Trash2 className="w-3.5 h-3.5 mr-1" />清理7天前
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleCleanup(undefined, 5000)}>
              <Trash2 className="w-3.5 h-3.5 mr-1" />保留5000条
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchLogs()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" />刷新
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logs */}
      <Card>
        <CardContent className="p-4">
          <div className="max-h-[600px] overflow-y-auto rounded-md bg-muted/30 p-2 space-y-1.5">
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>加载失败: {error}</AlertDescription>
              </Alert>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <FileText className="w-12 h-12 text-muted-foreground/30" />
                <span className="text-sm text-muted-foreground">暂无日志</span>
              </div>
            ) : (
              logs.map((log, index) => {
                const style = getLevelStyle(log.level)
                return (
                  <div
                    key={`${log.timestamp}-${index}`}
                    className={cn("p-3 rounded-md bg-background border-l-[3px]", style.border)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={style.badge} className="gap-1 text-[10px] px-1.5 py-0">
                        {style.icon} {log.level.toUpperCase()}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      {log.source && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{log.source}</Badge>}
                    </div>
                    <p className="text-sm font-mono whitespace-pre-wrap break-words">{log.message}</p>
                  </div>
                )
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
