import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import * as Themes from '@radix-ui/themes'
import { Icons } from '@zhin.js/client'

const { Flex, Box, Spinner, Text, Callout, Heading, Badge, Grid, Card, Button, Code, Separator, ScrollArea } = Themes

interface PluginDetail {
  name: string
  filename: string
  status: 'active' | 'inactive'
  description: string
  commands: Array<{
    name: string
    pattern: string
    description: string
    alias: string[]
    examples: string[]
  }>
  components: Array<{
    name: string
    props: Record<string, any>
    type: string
  }>
  middlewares: Array<{
    id: string
    type: string
  }>
  contexts: Array<{
    name: string
    description: string
  }>
  crons: Array<{
    id: string
    pattern: string
    running: boolean
  }>
  schemas: Array<{
    name: string
    fields: string[]
  }>
  statistics: {
    commandCount: number
    componentCount: number
    middlewareCount: number
    contextCount: number
    cronCount: number
    schemaCount: number
  }
}

export default function DashboardPluginDetail() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [plugin, setPlugin] = useState<PluginDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (name) {
      fetchPluginDetail(name)
    }
  }, [name])

  const fetchPluginDetail = async (pluginName: string) => {
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(pluginName)}`, { credentials: 'include' })
      if (!res.ok) throw new Error('API 请求失败')

      const data = await res.json()
      if (data.success) {
        setPlugin(data.data)
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

  if (error || !plugin) {
    return (
      <Box>
        <Button variant="ghost" onClick={() => navigate('/plugins')} mb="4" size="2">
          <Icons.ArrowLeft className="w-4 h-4" />
          返回
        </Button>
        <Callout.Root color="red">
          <Callout.Icon>
            <Icons.AlertCircle />
          </Callout.Icon>
          <Callout.Text>
            加载失败: {error || '插件不存在'}
          </Callout.Text>
        </Callout.Root>
      </Box>
    )
  }

  return (
    <Box>
      {/* 头部 */}
      <Flex direction="column" gap="3" mb="4">
        <Button variant="ghost" onClick={() => navigate('/plugins')} size="2" className="self-start">
          <Icons.ArrowLeft className="w-4 h-4" />
          返回
        </Button>

        <Flex align="center" gap="3">
          <Flex align="center" justify="center" className="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-400/10">
            <Icons.Package className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </Flex>
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Heading size="5">{plugin.name}</Heading>
              <Badge color={plugin.status === 'active' ? 'green' : 'gray'} size="1">
                {plugin.status === 'active' ? '运行中' : '已停止'}
              </Badge>
            </Flex>
            <Text size="2" color="gray">{plugin.description || '暂无描述'}</Text>
          </Flex>
        </Flex>
      </Flex>

      <Separator size="4" mb="4" />

      {/* 统计概览 - 紧凑卡片 */}
      <Grid columns={{ initial: '2', sm: '3', md: '6' }} gap="2" mb="4">
        <Card size="1">
          <Flex direction="column" align="center" gap="1" p="2">
            <Icons.Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <Text size="4" weight="bold">{plugin.statistics.commandCount}</Text>
            <Text size="1" color="gray">命令</Text>
          </Flex>
        </Card>

        <Card size="1">
          <Flex direction="column" align="center" gap="1" p="2">
            <Icons.Box className="w-4 h-4 text-green-600 dark:text-green-400" />
            <Text size="4" weight="bold">{plugin.statistics.componentCount}</Text>
            <Text size="1" color="gray">组件</Text>
          </Flex>
        </Card>

        <Card size="1">
          <Flex direction="column" align="center" gap="1" p="2">
            <Icons.Layers className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <Text size="4" weight="bold">{plugin.statistics.middlewareCount}</Text>
            <Text size="1" color="gray">中间件</Text>
          </Flex>
        </Card>

        <Card size="1">
          <Flex direction="column" align="center" gap="1" p="2">
            <Icons.Database className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            <Text size="4" weight="bold">{plugin.statistics.contextCount}</Text>
            <Text size="1" color="gray">上下文</Text>
          </Flex>
        </Card>

        <Card size="1">
          <Flex direction="column" align="center" gap="1" p="2">
            <Icons.Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <Text size="4" weight="bold">{plugin.statistics.cronCount}</Text>
            <Text size="1" color="gray">定时任务</Text>
          </Flex>
        </Card>

        <Card size="1">
          <Flex direction="column" align="center" gap="1" p="2">
            <Icons.FileText className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <Text size="4" weight="bold">{plugin.statistics.schemaCount}</Text>
            <Text size="1" color="gray">数据模型</Text>
          </Flex>
        </Card>
      </Grid>

      {/* 详细信息 - 紧凑布局 */}
      <Grid columns={{ initial: '1', md: '2' }} gap="3">
        {/* 命令列表 */}
        {plugin.commands.length > 0 && (
          <Card size="2">
            <Flex direction="column" gap="2" p="3">
              <Flex align="center" gap="2">
                <Icons.Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <Heading size="3">命令</Heading>
                <Badge size="1">{plugin.commands.length}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2" className="max-h-60 overflow-y-auto">
                {plugin.commands.map((cmd, index) => (
                  <Box key={index} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2">
                    <Flex direction="column" gap="1">
                      <Flex align="center" gap="2">
                        <Code size="2">{cmd.name}</Code>
                        {cmd.alias.length > 0 && (
                          <Text size="1" color="gray">别名: {cmd.alias.join(', ')}</Text>
                        )}
                      </Flex>
                      <Text size="1" color="gray">{cmd.description}</Text>
                      {cmd.examples.length > 0 && (
                        <Text size="1" color="gray" className="italic">示例: {cmd.examples[0]}</Text>
                      )}
                    </Flex>
                  </Box>
                ))}
              </Flex>
            </Flex>
          </Card>
        )}

        {/* 组件列表 */}
        {plugin.components.length > 0 && (
          <Card size="2">
            <Flex direction="column" gap="2" p="3">
              <Flex align="center" gap="2">
                <Icons.Box className="w-4 h-4 text-green-600 dark:text-green-400" />
                <Heading size="3">组件</Heading>
                <Badge size="1">{plugin.components.length}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2" className="max-h-60 overflow-y-auto">
                {plugin.components.map((comp, index) => (
                  <Box key={index} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2">
                    <Flex direction="column" gap="1">
                      <Flex align="center" gap="2">
                        <Code size="2">{comp.name}</Code>
                        <Badge size="1" variant="soft">{comp.type}</Badge>
                      </Flex>
                      <Text size="1" color="gray">
                        属性数: {Object.keys(comp.props).length}
                      </Text>
                    </Flex>
                  </Box>
                ))}
              </Flex>
            </Flex>
          </Card>
        )}

        {/* 中间件列表 */}
        {plugin.middlewares.length > 0 && (
          <Card size="2">
            <Flex direction="column" gap="2" p="3">
              <Flex align="center" gap="2">
                <Icons.Layers className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <Heading size="3">中间件</Heading>
                <Badge size="1">{plugin.middlewares.length}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2" className="max-h-60 overflow-y-auto">
                {plugin.middlewares.map((mw, index) => (
                  <Box key={index} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2">
                    <Flex align="center" gap="2">
                      <Code size="2">{mw.id}</Code>
                      <Badge size="1" variant="soft">{mw.type}</Badge>
                    </Flex>
                  </Box>
                ))}
              </Flex>
            </Flex>
          </Card>
        )}

        {/* 上下文列表 */}
        {plugin.contexts.length > 0 && (
          <Card size="2">
            <Flex direction="column" gap="2" p="3">
              <Flex align="center" gap="2">
                <Icons.Database className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <Heading size="3">上下文</Heading>
                <Badge size="1">{plugin.contexts.length}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2" className="max-h-60 overflow-y-auto">
                {plugin.contexts.map((ctx, index) => (
                  <Box key={index} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2">
                    <Flex direction="column" gap="1">
                      <Code size="2">{ctx.name}</Code>
                      <Text size="1" color="gray">{ctx.description}</Text>
                    </Flex>
                  </Box>
                ))}
              </Flex>
            </Flex>
          </Card>
        )}

        {/* 定时任务列表 */}
        {plugin.crons.length > 0 && (
          <Card size="2">
            <Flex direction="column" gap="2" p="3">
              <Flex align="center" gap="2">
                <Icons.Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <Heading size="3">定时任务</Heading>
                <Badge size="1">{plugin.crons.length}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2" className="max-h-60 overflow-y-auto">
                {plugin.crons.map((cron, index) => (
                  <Box key={index} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2">
                    <Flex justify="between" align="center">
                      <Flex direction="column" gap="1">
                        <Code size="2">{cron.id}</Code>
                        <Text size="1" color="gray">{cron.pattern}</Text>
                      </Flex>
                      <Badge color={cron.running ? 'green' : 'gray'} size="1">
                        {cron.running ? '运行中' : '已停止'}
                      </Badge>
                    </Flex>
                  </Box>
                ))}
              </Flex>
            </Flex>
          </Card>
        )}

        {/* 数据模型列表 */}
        {plugin.schemas.length > 0 && (
          <Card size="2">
            <Flex direction="column" gap="2" p="3">
              <Flex align="center" gap="2">
                <Icons.FileText className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <Heading size="3">数据模型</Heading>
                <Badge size="1">{plugin.schemas.length}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2" className="max-h-60 overflow-y-auto">
                {plugin.schemas.map((schema, index) => (
                  <Box key={index} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2">
                    <Flex direction="column" gap="1">
                      <Code size="2">{schema.name}</Code>
                      <Text size="1" color="gray">
                        字段: {schema.fields.join(', ')}
                      </Text>
                    </Flex>
                  </Box>
                ))}
              </Flex>
            </Flex>
          </Card>
        )}
      </Grid>
    </Box>
  )
}
