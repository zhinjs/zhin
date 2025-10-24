import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {Flex,Box,Spinner,Text,Callout,Heading,Badge,Grid,Card,Button} from '@radix-ui/themes'
import { Bot, AlertCircle, Activity, Package, Clock, Cpu, MemoryStick, FileText, TrendingUp } from 'lucide-react'

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
  memory: {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
  }
  cpu: {
    user: number
    system: number
  }
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

  const formatMemory = (bytes: number) => {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
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

  if (error) {
    return (
      <Flex align="center" justify="center" style={{ height: '100%' }}>
        <Callout.Root color="red">
          <Callout.Icon>
            <AlertCircle />
          </Callout.Icon>
          <Callout.Text>
            加载失败: {error}
          </Callout.Text>
        </Callout.Root>
      </Flex>
    )
  }

  return (
    <Box>
      {/* 页面标题 */}
      <Flex direction="column" gap="2" mb="6">
        <Heading size="8">系统概览</Heading>
        <Text color="gray">实时监控您的机器人框架运行状态</Text>
      </Flex>

      {/* 统计卡片 */}
      <Grid columns={{ initial: '1', sm: '2', lg: '4' }} gap="4" mb="6">
        <Card>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium" color="gray">插件总数</Text>
              <Box p="2" style={{ borderRadius: '8px', backgroundColor: 'var(--purple-3)' }}>
                <Package size={16} color="var(--purple-9)" />
              </Box>
            </Flex>
            <Heading size="7">{stats?.plugins.total || 0}</Heading>
            <Flex align="center" gap="1">
              <Badge color="blue">{stats?.plugins.active || 0}</Badge>
              <Text size="1" color="gray">个活跃</Text>
            </Flex>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium" color="gray">机器人</Text>
              <Bot size={16} color="var(--gray-9)" />
            </Flex>
            <Heading size="7">{stats?.bots.total || 0}</Heading>
            <Text size="1" color="green">
              {stats?.bots.online || 0} 个在线
            </Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium" color="gray">命令数量</Text>
              <Activity size={16} color="var(--gray-9)" />
            </Flex>
            <Heading size="7">{stats?.commands || 0}</Heading>
            <Text size="1" color="gray">可用命令</Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium" color="gray">组件数量</Text>
              <TrendingUp size={16} color="var(--gray-9)" />
            </Flex>
            <Heading size="7">{stats?.components || 0}</Heading>
            <Text size="1" color="gray">已注册组件</Text>
          </Flex>
        </Card>
      </Grid>

      {/* 系统状态 */}
      <Grid columns={{ initial: '1', md: '2' }} gap="4" mb="6">
        <Card>
          <Flex direction="column" gap="4">
            <Box>
              <Heading size="5" mb="1">系统信息</Heading>
              <Text size="2" color="gray">服务器运行状态</Text>
            </Box>

            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <Clock size={16} color="var(--gray-9)" />
                  <Text size="2">运行时间</Text>
                </Flex>
                <Badge variant="soft">
                  {systemStatus ? formatUptime(systemStatus.uptime) : '-'}
                </Badge>
              </Flex>

              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <Cpu size={16} color="var(--gray-9)" />
                  <Text size="2">平台</Text>
                </Flex>
                <Badge variant="soft">
                  {systemStatus?.platform || '-'}
                </Badge>
              </Flex>

              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <Activity size={16} color="var(--gray-9)" />
                  <Text size="2">Node 版本</Text>
                </Flex>
                <Badge variant="soft">
                  {systemStatus?.nodeVersion || '-'}
                </Badge>
              </Flex>
            </Flex>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="4">
            <Box>
              <Heading size="5" mb="1">资源使用</Heading>
              <Text size="2" color="gray">内存使用情况</Text>
            </Box>

            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <MemoryStick size={16} color="var(--gray-9)" />
                  <Text size="2">堆内存使用</Text>
                </Flex>
                <Badge variant="soft">
                  {stats ? `${stats.memory.toFixed(2)} MB` : '-'}
                </Badge>
              </Flex>

              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <MemoryStick size={16} color="var(--gray-9)" />
                  <Text size="2">总堆内存</Text>
                </Flex>
                <Badge variant="soft">
                  {systemStatus ? formatMemory(systemStatus.memory.heapTotal) : '-'}
                </Badge>
              </Flex>

              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <MemoryStick size={16} color="var(--gray-9)" />
                  <Text size="2">RSS</Text>
                </Flex>
                <Badge variant="soft">
                  {systemStatus ? formatMemory(systemStatus.memory.rss) : '-'}
                </Badge>
              </Flex>
            </Flex>
          </Flex>
        </Card>
      </Grid>

      {/* 快速操作 */}
      <Card>
        <Flex direction="column" gap="4">
          <Box>
            <Heading size="5" mb="1">快速操作</Heading>
            <Text size="2" color="gray">常用功能快捷入口</Text>
          </Box>

          <Grid columns={{ initial: '1', md: '3' }} gap="3">
            <Button 
              variant="outline"
              onClick={() => navigate('/plugins')}
              style={{ height: 'auto', padding: '16px', cursor: 'pointer' }}
            >
              <Flex direction="column" align="start" gap="2" style={{ width: '100%' }}>
                <Package size={20} color="var(--blue-9)" />
                <Text weight="medium">插件管理</Text>
                <Text size="1" color="gray">查看和管理插件</Text>
              </Flex>
            </Button>

            <Button 
              variant="outline"
              onClick={() => navigate('/bots')}
              style={{ height: 'auto', padding: '16px', cursor: 'pointer' }}
            >
              <Flex direction="column" align="start" gap="2" style={{ width: '100%' }}>
                <Bot size={20} color="var(--green-9)" />
                <Text weight="medium">机器人状态</Text>
                <Text size="1" color="gray">监控机器人运行</Text>
              </Flex>
            </Button>

            <Button 
              variant="outline"
              onClick={() => navigate('/logs')}
              style={{ height: 'auto', padding: '16px', cursor: 'pointer' }}
            >
              <Flex direction="column" align="start" gap="2" style={{ width: '100%' }}>
                <FileText size={20} color="var(--purple-9)" />
                <Text weight="medium">系统日志</Text>
                <Text size="1" color="gray">查看运行日志</Text>
              </Flex>
            </Button>
          </Grid>
        </Flex>
      </Card>
    </Box>
  )
}
