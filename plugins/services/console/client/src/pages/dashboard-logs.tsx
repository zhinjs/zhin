import { useEffect, useState, useRef } from 'react'
import { Flex, Box, Spinner, Text, Callout, Heading, Badge, Grid, Card, Button, Select, Checkbox } from '@radix-ui/themes'
import { Info, AlertTriangle, XCircle, Circle, Trash2, RefreshCw, FileText, AlertCircle } from 'lucide-react'

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
    const interval = setInterval(() => {
      fetchLogs()
      fetchStats()
    }, 3000)
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
      const url = levelFilter === 'all' 
        ? '/api/logs?limit=100' 
        : `/api/logs?limit=100&level=${levelFilter}`
      
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error('API 请求失败')

      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setLogs(data.data.reverse())
        setError(null)
      }
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
      if (data.success) {
        setStats(data.data)
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }

  const handleCleanup = async (days?: number, maxRecords?: number) => {
    const message = days 
      ? `确定清理 ${days} 天前的日志吗？`
      : `确定只保留最近 ${maxRecords} 条日志吗？`
    
    if (!confirm(message)) return

    try {
      const res = await fetch('/api/logs/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, maxRecords }),
        credentials: 'include'
      })

      if (!res.ok) throw new Error('清理失败')

      const data = await res.json()
      if (data.success) {
        alert(`成功清理 ${data.data.deletedCount} 条日志`)
        fetchLogs()
        fetchStats()
      }
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const getLevelColor = (level: string): 'blue' | 'amber' | 'red' | 'gray' => {
    switch (level) {
      case 'info': return 'blue'
      case 'warn': return 'amber'
      case 'error': return 'red'
      default: return 'gray'
    }
  }

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'info': return <Info size={14} />
      case 'warn': return <AlertTriangle size={14} />
      case 'error': return <XCircle size={14} />
      default: return <Circle size={14} />
    }
  }

  if (loading) {
    return (
      <Flex align="center" justify="center" style={{ height: '100%' }}>
        <Box>
          <Spinner size="3" />
          <Text size="2" color="gray" style={{ marginTop: '8px' }}>加载中...</Text>
        </Box>
      </Flex>
    )
  }

  return (
    <Box>
      {/* 页面标题 */}
      <Flex direction="column" gap="2" mb="4">
        <Heading size="8">系统日志</Heading>
        <Text color="gray">实时查看系统运行日志</Text>
      </Flex>

      {/* 日志统计 */}
      {stats && (
        <Grid columns={{ initial: '2', sm: '4' }} gap="3" mb="4">
          <Card>
            <Flex direction="column" align="center" gap="1" p="3">
              <Text size="5" weight="bold">{stats.total}</Text>
              <Text size="1" color="gray">总日志数</Text>
            </Flex>
          </Card>
          <Card>
            <Flex direction="column" align="center" gap="1" p="3">
              <Text size="5" weight="bold" color="blue">{stats.byLevel.info || 0}</Text>
              <Text size="1" color="gray">Info</Text>
            </Flex>
          </Card>
          <Card>
            <Flex direction="column" align="center" gap="1" p="3">
              <Text size="5" weight="bold" color="amber">{stats.byLevel.warn || 0}</Text>
              <Text size="1" color="gray">Warn</Text>
            </Flex>
          </Card>
          <Card>
            <Flex direction="column" align="center" gap="1" p="3">
              <Text size="5" weight="bold" color="red">{stats.byLevel.error || 0}</Text>
              <Text size="1" color="gray">Error</Text>
            </Flex>
          </Card>
        </Grid>
      )}

      {/* 工具栏 */}
      <Card mb="4">
        <Flex justify="between" align="center" p="3" wrap="wrap" gap="3">
          <Flex align="center" gap="3" wrap="wrap">
            <Select.Root value={levelFilter} onValueChange={setLevelFilter}>
              <Select.Trigger style={{ minWidth: '120px' }} />
              <Select.Content>
                <Select.Item value="all">所有级别</Select.Item>
                <Select.Item value="info">Info</Select.Item>
                <Select.Item value="warn">Warn</Select.Item>
                <Select.Item value="error">Error</Select.Item>
              </Select.Content>
            </Select.Root>

            <Flex as="span">
              <Checkbox 
                checked={autoScroll} 
                onCheckedChange={(checked) => setAutoScroll(checked as boolean)}
              />
              <Text size="2">自动滚动</Text>
            </Flex>
          </Flex>

          <Flex gap="2">
            <Button 
              variant="soft" 
              onClick={() => handleCleanup(7)}
              size="2"
            >
              <Trash2 size={14} />
              清理7天前
            </Button>
            <Button 
              variant="soft" 
              onClick={() => handleCleanup(undefined, 5000)}
              size="2"
            >
              <Trash2 size={14} />
              保留5000条
            </Button>
            <Button 
              variant="soft" 
              onClick={() => fetchLogs()}
              size="2"
            >
              <RefreshCw size={14} />
              刷新
            </Button>
          </Flex>
        </Flex>
      </Card>

      {/* 日志列表 */}
      <Card>
        <Box 
          p="4" 
          style={{ 
            maxHeight: '600px', 
            overflowY: 'auto',
            backgroundColor: 'var(--gray-1)'
          }}
        >
          {error ? (
            <Callout.Root color="red">
              <Callout.Icon>
                <AlertCircle />
              </Callout.Icon>
              <Callout.Text>
                加载失败: {error}
              </Callout.Text>
            </Callout.Root>
          ) : logs.length === 0 ? (
            <Flex direction="column" align="center" gap="3" py="9">
              <FileText size={48} color="var(--gray-6)" />
              <Text color="gray">暂无日志</Text>
            </Flex>
          ) : (
            <Flex direction="column" gap="2">
              {logs.map((log, index) => (
                <Box 
                  key={`${log.timestamp}-${index}`}
                  p="3"
                  style={{ 
                    borderRadius: '6px',
                    backgroundColor: 'var(--gray-2)',
                    borderLeft: `3px solid var(--${getLevelColor(log.level)}-9)`
                  }}
                >
                  <Flex direction="column" gap="1">
                    <Flex align="center" gap="2">
                      <Badge color={getLevelColor(log.level)} size="1">
                        <Flex align="center" gap="1">
                          {getLevelIcon(log.level)}
                          {log.level.toUpperCase()}
                        </Flex>
                      </Badge>
                      <Text size="1" color="gray">
                        {new Date(log.timestamp).toLocaleString()}
                      </Text>
                      {log.source && (
                        <Badge variant="soft" size="1">{log.source}</Badge>
                      )}
                    </Flex>
                    <Text 
                      size="2" 
                      style={{ 
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}
                    >
                      {log.message}
                    </Text>
                  </Flex>
                </Box>
              ))}
              <div ref={logsEndRef} />
            </Flex>
          )}
        </Box>
      </Card>
    </Box>
  )
}
