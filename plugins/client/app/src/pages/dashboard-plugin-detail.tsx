import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { Flex, Box, Spinner, Text, Callout, Heading, Badge, Grid, Card, Button, Code, Separator } from '@radix-ui/themes'
import { Terminal, Layers, Database, Clock, FileText, AlertCircle, ArrowLeft } from 'lucide-react'

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
      <Flex align="center" justify="center" style={{ height: '100%' }}>
        <Box>
          <Spinner size="3" />
          <Text size="2" color="gray" style={{ marginTop: '8px' }}>加载中...</Text>
        </Box>
      </Flex>
    )
  }

  if (error || !plugin) {
    return (
      <Box>
        <Button variant="ghost" onClick={() => navigate('/plugins')} mb="4">
          <ArrowLeft size={16} />
          返回插件列表
        </Button>
        <Callout.Root color="red">
          <Callout.Icon>
            <AlertCircle />
          </Callout.Icon>
          <Callout.Text>
            {error || '插件不存在'}
          </Callout.Text>
        </Callout.Root>
      </Box>
    )
  }

  return (
    <Box>
      {/* 返回按钮 */}
      <Button variant="ghost" onClick={() => navigate('/plugins')} mb="4">
        <ArrowLeft size={16} />
        返回插件列表
      </Button>

      {/* 插件标题 */}
      <Flex direction="column" gap="2" mb="6">
        <Flex align="center" gap="3">
          <Heading size="8">{plugin.name}</Heading>
          <Badge color={plugin.status === 'active' ? 'green' : 'gray'} size="2">
            {plugin.status === 'active' ? '运行中' : '已停止'}
          </Badge>
        </Flex>
        <Text color="gray">{plugin.description || '暂无描述'}</Text>
        <Text size="1" color="gray">文件: {plugin.filename}</Text>
      </Flex>

      <Separator size="4" mb="6" />

      {/* 统计信息 */}
      <Grid columns={{ initial: '2', sm: '3', lg: '6' }} gap="3" mb="6">
        <Card>
          <Flex direction="column" align="center" gap="2" p="3">
            <Terminal size={24} color="var(--blue-9)" />
            <Text size="5" weight="bold">{plugin.statistics.commandCount}</Text>
            <Text size="1" color="gray">命令</Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" align="center" gap="2" p="3">
            <Box style={{ width: 24, height: 24, backgroundColor: 'var(--green-9)' }} />
            <Text size="5" weight="bold">{plugin.statistics.componentCount}</Text>
            <Text size="1" color="gray">组件</Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" align="center" gap="2" p="3">
            <Layers size={24} color="var(--purple-9)" />
            <Text size="5" weight="bold">{plugin.statistics.middlewareCount}</Text>
            <Text size="1" color="gray">中间件</Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" align="center" gap="2" p="3">
            <Database size={24} color="var(--orange-9)" />
            <Text size="5" weight="bold">{plugin.statistics.contextCount}</Text>
            <Text size="1" color="gray">上下文</Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" align="center" gap="2" p="3">
            <Clock size={24} color="var(--red-9)" />
            <Text size="5" weight="bold">{plugin.statistics.cronCount}</Text>
            <Text size="1" color="gray">定时任务</Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" align="center" gap="2" p="3">
            <FileText size={24} color="var(--cyan-9)" />
            <Text size="5" weight="bold">{plugin.statistics.schemaCount}</Text>
            <Text size="1" color="gray">数据模型</Text>
          </Flex>
        </Card>
      </Grid>

      {/* 详细信息 */}
      <Flex direction="column" gap="4">
        {/* 命令列表 */}
        {plugin.commands.length > 0 && (
          <Card>
            <Box p="4">
              <Heading size="5" mb="3">命令列表</Heading>
              <Flex direction="column" gap="3">
                {plugin.commands.map((cmd, index) => (
                  <Box key={index} p="3" style={{ borderRadius: '8px', backgroundColor: 'var(--gray-2)' }}>
                    <Flex direction="column" gap="2">
                      <Flex align="center" gap="2">
                        <Code>{cmd.name}</Code>
                        {cmd.alias.length > 0 && (
                          <Flex gap="1">
                            {cmd.alias.map((a, i) => (
                              <Badge key={i} variant="soft" size="1">{a}</Badge>
                            ))}
                          </Flex>
                        )}
                      </Flex>
                      <Text size="2" color="gray">{cmd.description || '无描述'}</Text>
                      {cmd.pattern && (
                        <Text size="1" color="gray">模式: {cmd.pattern}</Text>
                      )}
                      {cmd.examples.length > 0 && (
                        <Box>
                          <Text size="1" weight="bold" color="gray">示例:</Text>
                          {cmd.examples.map((ex, i) => (
                            <Code key={i} size="1">{ex}</Code>
                          ))}
                        </Box>
                      )}
                    </Flex>
                  </Box>
                ))}
              </Flex>
            </Box>
          </Card>
        )}

        {/* 组件列表 */}
        {plugin.components.length > 0 && (
          <Card>
            <Box p="4">
              <Heading size="5" mb="3">组件列表</Heading>
              <Grid columns={{ initial: '1', md: '2' }} gap="3">
                {plugin.components.map((comp, index) => (
                  <Box key={index} p="3" style={{ borderRadius: '8px', backgroundColor: 'var(--gray-2)' }}>
                    <Flex direction="column" gap="2">
                      <Flex align="center" gap="2">
                        <Box style={{ width: 16, height: 16, backgroundColor: 'var(--green-9)' }} />
                        <Text weight="bold">{comp.name}</Text>
                        <Badge variant="soft" size="1">{comp.type}</Badge>
                      </Flex>
                      <Text size="1" color="gray">
                        Props: {Object.keys(comp.props).length} 个
                      </Text>
                    </Flex>
                  </Box>
                ))}
              </Grid>
            </Box>
          </Card>
        )}

        {/* 其他信息 */}
        <Grid columns={{ initial: '1', lg: '2' }} gap="4">
          {/* 中间件 */}
          {plugin.middlewares.length > 0 && (
            <Card>
              <Box p="4">
                <Heading size="5" mb="3">中间件</Heading>
                <Flex direction="column" gap="2">
                  {plugin.middlewares.map((mw, index) => (
                    <Flex key={index} align="center" gap="2" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                      <Layers size={14} color="var(--purple-9)" />
                      <Text size="2">{mw.id}</Text>
                      <Badge variant="soft" size="1">{mw.type}</Badge>
                    </Flex>
                  ))}
                </Flex>
              </Box>
            </Card>
          )}

          {/* 定时任务 */}
          {plugin.crons.length > 0 && (
            <Card>
              <Box p="4">
                <Heading size="5" mb="3">定时任务</Heading>
                <Flex direction="column" gap="2">
                  {plugin.crons.map((cron, index) => (
                    <Flex key={index} justify="between" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                      <Flex align="center" gap="2">
                        <Clock size={14} color="var(--red-9)" />
                        <Code size="1">{cron.pattern}</Code>
                      </Flex>
                      <Badge color={cron.running ? 'green' : 'gray'} size="1">
                        {cron.running ? '运行中' : '已停止'}
                      </Badge>
                    </Flex>
                  ))}
                </Flex>
              </Box>
            </Card>
          )}
        </Grid>
      </Flex>
    </Box>
  )
}
