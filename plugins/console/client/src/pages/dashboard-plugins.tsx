import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import * as Themes from '@radix-ui/themes'
import { Icons } from '@zhin.js/client'

const { Flex, Box, Spinner, Text, Callout, Heading, Badge, Grid, Card, Separator } = Themes

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
      <Flex align="center" justify="center" className="h-full">
        <Flex direction="column" align="center" gap="3">
          <Spinner size="3" />
          <Text size="2" color="gray">加载中...</Text>
        </Flex>
      </Flex>
    )
  }

  if (error) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <Callout.Root color="red">
          <Callout.Icon>
            <Icons.AlertCircle />
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
      <Flex direction="column" gap="2" mb="4">
        <Heading size="6">插件管理</Heading>
        <Flex align="center" gap="2">
          <Text size="2" color="gray">共 {plugins.length} 个插件</Text>
          <Badge color="green" size="1">{plugins.filter(p => p.status === 'active').length}</Badge>
          <Text size="2" color="gray">个运行中</Text>
        </Flex>
      </Flex>

      {/* 插件列表 - 紧凑网格 */}
      <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="3">
        {plugins.map((plugin, index) => (
          <Card 
            key={`${plugin.name}-${index}`}
            className="cursor-pointer hover-lift transition-smooth"
            onClick={() => navigate(`/plugins/${encodeURIComponent(plugin.name)}`)}
          >
            <Flex direction="column" gap="2" p="2">
              {/* 头部 - 紧凑布局 */}
              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <Flex align="center" justify="center" className="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-400/10">
                    <Icons.Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </Flex>
                  <Heading size="3">{plugin.name}</Heading>
                </Flex>
                <Badge 
                  color={plugin.status === 'active' ? 'green' : 'gray'}
                  size="1"
                >
                  {plugin.status === 'active' ? '运行中' : '已停止'}
                </Badge>
              </Flex>

              {/* 描述 - 限制两行 */}
              <Text size="1" color="gray" className="line-clamp-2">
                {plugin.description || '暂无描述'}
              </Text>

              <Separator size="4" my="1" />

              {/* 统计信息 - 紧凑网格 */}
              <Grid columns={{ initial: '1', sm: '2', lg: '4' }} gap="1">
                <Flex gap="2" justify="center" align="center" className="rounded-md bg-blue-500/5 dark:bg-blue-400/5 p-1.5">
                  <Icons.Terminal className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                  <Text size="2" weight="bold" className="mt-0.5">{plugin.commandCount}</Text>
                  <Text size="1" color="gray">命令</Text>
                </Flex>

                <Flex gap="2" justify="center" align="center" className="rounded-md bg-green-500/5 dark:bg-green-400/5 p-1.5">
                  <Icons.Box className="w-3 h-3 text-green-600 dark:text-green-400" />
                  <Text size="2" weight="bold" className="mt-0.5">{plugin.componentCount}</Text>
                  <Text size="1" color="gray">组件</Text>
                </Flex>

                <Flex gap="2" justify="center" align="center" className="rounded-md bg-purple-500/5 dark:bg-purple-400/5 p-1.5">
                  <Icons.Layers className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                  <Text size="2" weight="bold" className="mt-0.5">{plugin.middlewareCount}</Text>
                  <Text size="1" color="gray">中间件</Text>
                </Flex>

                <Flex gap="2" justify="center" align="center" className="rounded-md bg-orange-500/5 dark:bg-orange-400/5 p-1.5">
                  <Icons.Database className="w-3 h-3 text-orange-600 dark:text-orange-400" />
                  <Text size="2" weight="bold" className="mt-0.5">{plugin.contextCount}</Text>
                  <Text size="1" color="gray">上下文</Text>
                </Flex>
              </Grid>
            </Flex>
          </Card>
        ))}
      </Grid>

      {/* 空状态 */}
      {plugins.length === 0 && (
        <Card className="mt-6">
          <Flex direction="column" align="center" gap="3" py="8">
            <Flex align="center" justify="center" className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800">
              <Icons.Package className="w-8 h-8 text-gray-400" />
            </Flex>
            <Flex direction="column" align="center" gap="1">
              <Heading size="4">暂无插件</Heading>
              <Text size="2" color="gray">请先安装并启用插件</Text>
            </Flex>
          </Flex>
        </Card>
      )}
    </Box>
  )
}
