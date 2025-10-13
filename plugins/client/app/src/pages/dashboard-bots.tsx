import { useEffect, useState } from 'react'
import { Bot, AlertCircle, Wifi, WifiOff, Activity, Package, Zap } from 'lucide-react'
import {Flex,Box,Spinner,Text,Callout,Heading,Badge,Separator,Grid,Card} from '@radix-ui/themes'

interface BotInfo {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
}

export default function DashboardBots() {
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchBots()
    const interval = setInterval(fetchBots, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchBots = async () => {
    try {
      const res = await fetch('/api/bots', { credentials: 'include' })
      if (!res.ok) throw new Error('API 请求失败')

      const data = await res.json()
      if (data.success) {
        setBots(data.data)
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
        <Heading size="8">机器人管理</Heading>
        <Flex align="center" gap="2">
          <Text color="gray">共 {bots.length} 个机器人，</Text>
          <Badge color="green">{bots.filter(b => b.connected).length}</Badge>
          <Text color="gray">个在线</Text>
        </Flex>
      </Flex>

      <Separator size="4" mb="6" />

      {/* 机器人列表 */}
      <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="4">
        {bots.map((bot, index) => (
          <Card key={`${bot.adapter}-${bot.name}-${index}`}>
            <Flex direction="column" gap="3">
              {/* 头部 */}
              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <Box
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      backgroundColor: bot.connected ? 'var(--green-3)' : 'var(--gray-3)'
                    }}
                  >
                    <Bot 
                      size={20}
                      color={bot.connected ? 'var(--green-9)' : 'var(--gray-9)'}
                    />
                  </Box>
                  <Text size="4" weight="bold">{bot.name}</Text>
                </Flex>
                
                <Box style={{ position: 'relative' }}>
                  <Badge color={bot.connected ? 'green' : 'gray'}>
                    <Flex align="center" gap="1">
                      {bot.connected ? (
                        <>
                          <Wifi size={12} />
                          在线
                        </>
                      ) : (
                        <>
                          <WifiOff size={12} />
                          离线
                        </>
                      )}
                    </Flex>
                  </Badge>
                  {bot.connected && (
                    <Box
                      style={{
                        position: 'absolute',
                        top: '-4px',
                        right: '-4px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--green-9)',
                        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                      }}
                    />
                  )}
                </Box>
              </Flex>

              {/* 适配器信息 */}
              <Flex align="center" gap="2">
                <Text size="2" color="gray">适配器:</Text>
                <Badge variant="outline">{bot.adapter}</Badge>
              </Flex>

              <Separator size="4" />

              {/* 详细信息 */}
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                  <Flex align="center" gap="2">
                    <Activity 
                      size={16}
                      color={bot.status === 'online' ? 'var(--green-9)' : 'var(--gray-9)'}
                    />
                    <Text size="2" color="gray">运行状态</Text>
                  </Flex>
                  <Badge color={bot.status === 'online' ? 'green' : 'gray'}>
                    {bot.status === 'online' ? '运行中' : '已停止'}
                  </Badge>
                </Flex>

                <Flex justify="between" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                  <Flex align="center" gap="2">
                    <Package size={16} color="var(--blue-9)" />
                    <Text size="2" color="gray">适配器类型</Text>
                  </Flex>
                  <Text size="2" weight="medium">{bot.adapter}</Text>
                </Flex>

                <Flex justify="between" align="center" p="2" style={{ borderRadius: '6px', backgroundColor: 'var(--gray-2)' }}>
                  <Flex align="center" gap="2">
                    <Zap size={16} color="var(--purple-9)" />
                    <Text size="2" color="gray">连接状态</Text>
                  </Flex>
                  <Text size="2" weight="medium" color={bot.connected ? 'green' : 'gray'}>
                    {bot.connected ? '已连接' : '未连接'}
                  </Text>
                </Flex>
              </Flex>
            </Flex>
          </Card>
        ))}
      </Grid>

      {/* 空状态 */}
      {bots.length === 0 && (
        <Card>
          <Flex direction="column" align="center" gap="4" py="9">
            <Bot size={64} color="var(--gray-6)" />
            <Flex direction="column" align="center" gap="2">
              <Heading size="4">暂无机器人</Heading>
              <Text color="gray">请先配置并启动机器人</Text>
            </Flex>
          </Flex>
        </Card>
      )}
    </Box>
  )
}
