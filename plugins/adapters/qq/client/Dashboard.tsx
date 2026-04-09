import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from './utils/api'
import { RefreshCw, Server, Wifi, WifiOff, Power, PowerOff, ChevronRight, ChevronDown, Hash, Loader2 } from 'lucide-react'

interface BotInfo {
  name: string
  connected: boolean
  guildCount: number
  status: string
}

interface Guild {
  id: string
  name: string
  icon?: string
  description?: string
}

interface Channel {
  id: string
  name: string
  type?: number
}

type Tab = 'overview' | 'guilds'

export default function QQDashboard() {
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  // Guild browser state
  const [selectedBot, setSelectedBot] = useState('')
  const [guilds, setGuilds] = useState<Guild[]>([])
  const [guildsLoading, setGuildsLoading] = useState(false)
  const [expandedGuild, setExpandedGuild] = useState<string | null>(null)
  const [channels, setChannels] = useState<Record<string, Channel[]>>({})
  const [channelsLoading, setChannelsLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/qq/bots')
      const json = await res.json()
      if (json.success) setBots(json.data)
      else setError(json.error || '获取数据失败')
    } catch {
      setError('无法连接服务器')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleConnect = async (name: string, connected: boolean) => {
    setActionLoading(prev => ({ ...prev, [name]: true }))
    try {
      const endpoint = connected ? 'disconnect' : 'connect'
      const res = await apiFetch(`/api/qq/bots/${encodeURIComponent(name)}/${endpoint}`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) setError(json.error || '操作失败')
      await fetchData()
    } catch {
      setError('操作失败')
    } finally {
      setActionLoading(prev => ({ ...prev, [name]: false }))
    }
  }

  const loadGuilds = async (botName: string) => {
    setSelectedBot(botName)
    setGuildsLoading(true)
    setGuilds([])
    setExpandedGuild(null)
    setChannels({})
    try {
      const res = await apiFetch(`/api/qq/bots/${encodeURIComponent(botName)}/guilds`)
      const json = await res.json()
      if (json.success) setGuilds(json.data)
      else setError(json.error || '获取频道失败')
    } catch {
      setError('获取频道失败')
    } finally {
      setGuildsLoading(false)
    }
  }

  const toggleGuild = async (guildId: string) => {
    if (expandedGuild === guildId) { setExpandedGuild(null); return }
    setExpandedGuild(guildId)
    if (channels[guildId]) return
    setChannelsLoading(guildId)
    try {
      const res = await apiFetch(`/api/qq/bots/${encodeURIComponent(selectedBot)}/guilds/${encodeURIComponent(guildId)}/channels`)
      const json = await res.json()
      if (json.success) setChannels(prev => ({ ...prev, [guildId]: json.data }))
    } catch { /* ignore */ } finally {
      setChannelsLoading(null)
    }
  }

  const onlineBots = bots.filter(b => b.connected)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Server className="w-6 h-6" /> QQ 官方机器人
        </h1>
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded border border-red-200">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button onClick={() => setTab('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'overview' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          概览
        </button>
        <button onClick={() => setTab('guilds')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'guilds' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          频道浏览
        </button>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <>
          {!loading && !bots.length && !error && (
            <div className="text-center text-gray-500 py-12">暂无 QQ 机器人实例</div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {bots.map((bot) => (
              <div key={bot.name} className="border rounded-lg p-4 bg-card shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-lg">{bot.name}</span>
                  {bot.connected
                    ? <span className="flex items-center gap-1 text-green-600 text-sm"><Wifi className="w-4 h-4" /> 在线</span>
                    : <span className="flex items-center gap-1 text-gray-400 text-sm"><WifiOff className="w-4 h-4" /> 离线</span>}
                </div>
                <div className="grid grid-cols-1 gap-2 text-sm text-gray-600 mb-3">
                  <div className="flex justify-between"><span>频道数</span><span className="font-mono">{bot.guildCount}</span></div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleConnect(bot.name, bot.connected)}
                    disabled={actionLoading[bot.name]}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm text-white ${bot.connected ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} disabled:opacity-50`}>
                    {actionLoading[bot.name]
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : bot.connected ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    {bot.connected ? '断开' : '连接'}
                  </button>
                  {bot.connected && (
                    <button onClick={() => { setTab('guilds'); loadGuilds(bot.name) }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-gray-100 hover:bg-gray-200 text-gray-700">
                      <Hash className="w-3.5 h-3.5" /> 浏览频道
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Guilds Tab */}
      {tab === 'guilds' && (
        <div>
          {/* Bot selector */}
          {onlineBots.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <label className="text-sm text-gray-500">选择机器人：</label>
              <select value={selectedBot} onChange={(e) => loadGuilds(e.target.value)}
                className="border rounded px-2 py-1 text-sm">
                <option value="">--</option>
                {onlineBots.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            </div>
          )}
          {!onlineBots.length && <div className="text-center text-gray-500 py-8">暂无在线机器人</div>}
          {guildsLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>}

          {/* Guild → Channel tree */}
          {!guildsLoading && guilds.length > 0 && (
            <div className="border rounded-lg bg-card shadow-sm divide-y">
              {guilds.map((g) => (
                <div key={g.id}>
                  <button onClick={() => toggleGuild(g.id)}
                    className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 text-left">
                    {expandedGuild === g.id ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <span className="font-medium">{g.name}</span>
                    <span className="text-xs text-gray-400 ml-auto">{g.id}</span>
                  </button>
                  {expandedGuild === g.id && (
                    <div className="px-4 pb-3">
                      {channelsLoading === g.id
                        ? <div className="flex items-center gap-2 text-gray-400 text-sm py-2 pl-6"><Loader2 className="w-4 h-4 animate-spin" /> 加载中…</div>
                        : channels[g.id]?.length
                          ? <div className="pl-6 space-y-1">
                            {channels[g.id].map(ch => (
                              <div key={ch.id} className="flex items-center gap-2 text-sm text-gray-600 py-1">
                                <Hash className="w-3.5 h-3.5 text-gray-400" />
                                <span>{ch.name}</span>
                                <span className="text-xs text-gray-400 ml-auto">{ch.id}</span>
                              </div>
                            ))}
                          </div>
                          : <div className="pl-6 text-sm text-gray-400 py-1">无子频道</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!guildsLoading && selectedBot && !guilds.length && <div className="text-center text-gray-400 py-8">该机器人未加入任何频道</div>}
        </div>
      )}
    </div>
  )
}
