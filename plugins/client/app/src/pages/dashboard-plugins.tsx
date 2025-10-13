import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Flex, Box, Spinner, Text, Callout, Heading, Badge, Grid, Card, Button, Code, Separator } from '@radix-ui/themes'
import { Package, Layers, Database, Terminal, AlertCircle } from 'lucide-react'

interface Plugin {
  name: string
  status: 'active' | 'inactive'
  commandCount: number
  componentCount: number
  middlewareCount: number
  contextCount: number
  description: string
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
      const res = await fetch('/api/plugins', { credentials: 'include' })
      if (!res.ok) throw new Error('API 请求失败')

      const data = await res.json()
      if (data.success) {
        setPlugins(data.data)
        setError(null)
      } else {
        throw new Error('数据格式错误')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
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
        <Heading size="8">插件管理</Heading>
        <Flex align="center" gap="2">
          <Text color="gray">共 {plugins.length} 个插件，</Text>
          <Badge color="green">{plugins.filter(p => p.status === 'active').length}</Badge>
          <Text color="gray">个活跃</Text>
        </Flex>
      </Flex>

      <Separator size="4" mb="6" />

      {/* 插件列表 */}
      <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="4">
        {plugins.map((plugin, index) => (
          <Card 
            key={`${plugin.name}-${index}`}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/plugins/${encodeURIComponent(plugin.name)}`)}
          >
            <Flex direction="column" gap="3">
              {/* 头部 */}
              <Flex justify="between" align="start">
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Flex align="center" gap="2">
                    <Package size={20} color="var(--blue-9)" />
                    <Heading size="4">{plugin.name}</Heading>
                  </Flex>
                  <Text size="2" color="gray" style={{ 
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {plugin.description || '暂无描述'}
                  </Text>
                </Flex>
                <Badge color={plugin.status === 'active' ? 'green' : 'gray'}>
                  {plugin.status === 'active' ? '运行中' : '已停止'}
                </Badge>
              </Flex>

              <Separator size="4" />

              {/* 统计信息 */}
              <Grid columns="2" gap="2">
                <Flex direction="column" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                  <Terminal size={16} color="var(--blue-9)" />
                  <Text size="4" weight="bold" mt="1">{plugin.commandCount}</Text>
                  <Text size="1" color="gray">命令</Text>
                </Flex>

                <Flex direction="column" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                  <Box style={{ width: 16, height: 16, backgroundColor: 'var(--green-9)' }} />
                  <Text size="4" weight="bold" mt="1">{plugin.componentCount}</Text>
                  <Text size="1" color="gray">组件</Text>
                </Flex>

                <Flex direction="column" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                  <Layers size={16} color="var(--purple-9)" />
                  <Text size="4" weight="bold" mt="1">{plugin.middlewareCount}</Text>
                  <Text size="1" color="gray">中间件</Text>
                </Flex>

                <Flex direction="column" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                  <Database size={16} color="var(--orange-9)" />
                  <Text size="4" weight="bold" mt="1">{plugin.contextCount}</Text>
                  <Text size="1" color="gray">上下文</Text>
                </Flex>
              </Grid>
            </Flex>
          </Card>
        ))}
      </Grid>

      {/* 空状态 */}
      {plugins.length === 0 && (
        <Card>
          <Flex direction="column" align="center" gap="4" py="9">
            <Package size={64} color="var(--gray-6)" />
            <Flex direction="column" align="center" gap="2">
              <Heading size="4">暂无插件</Heading>
              <Text color="gray">请先安装并启用插件</Text>
            </Flex>
          </Flex>
        </Card>
      )}
    </Box>
  )
}
