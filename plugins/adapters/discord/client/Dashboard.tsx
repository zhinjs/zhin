import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from './utils/api'
import { RefreshCw, Server, Wifi, WifiOff, Power, PowerOff, Users, Loader2, Globe } from 'lucide-react'

interface BotInfo {
  name: string
  connected: boolean
  mode: string
  guildCount: number
  channelCount: number
  status: string
  user: { tag: string; id: string } | null
}

interface GuildInfo {
  id: string
  name: string
  memberCount: number
  icon: string | null
}

type Tab = 'overview' | 'guilds'

export default function DiscordDashboard() {
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  // Guild browser state
  const [selectedBot, setSelectedBot] = useState('')
  const [guilds, setGuilds] = useState<GuildInfo[]>([])
  const [guildsLoading, setGuildsLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/discord/bots')
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
      const res = await apiFetch(`/api/discord/bots/${encodeURIComponent(name)}/${endpoint}`, { method: 'POST' })
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
    try {
      const res = await apiFetch(`/api/discord/bots/${encodeURIComponent(botName)}/guilds`)
      const json = await res.json()
      if (json.success) setGuilds(json.data)
      else setError(json.error || '获取服务器列表失败')
    } catch {
      setError('获取服务器列表失败')
    } finally {
      setGuildsLoading(false)
    }
  }

  const gatewayBots = bots.filter(b => b.connected && b.mode === 'gateway')

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Server className="w-6 h-6" /> Discord 机器人
        </h1>
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded border border-red-200">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button onClick={() => setTab('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'overview' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          概览
        </button>
        <button onClick={() => setTab('guilds')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'guilds' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          服务器列表
        </button>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <>
          {!loading && !bots.length && !error && (
            <div className="text-center text-gray-500 py-12">暂无 Discord 机器人实例</div>
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
                {bot.user && <div className="text-sm text-gray-500 mb-2">@{bot.user.tag}</div>}
                <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 mb-3">
                  <div className="flex justify-between"><span>模式</span><span className="font-mono">{bot.mode}</span></div>
                  <div className="flex justify-between"><span>服务器</span><span className="font-mono">{bot.guildCount}</span></div>
                  <div className="flex justify-between"><span>频道</span><span className="font-mono">{bot.channelCount}</span></div>
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
                  {bot.connected && bot.mode === 'gateway' && (
                    <button onClick={() => { setTab('guilds'); loadGuilds(bot.name) }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-gray-100 hover:bg-gray-200 text-gray-700">
                      <Globe className="w-3.5 h-3.5" /> 查看服务器
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
          {gatewayBots.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <label className="text-sm text-gray-500">选择机器人：</label>
              <select value={selectedBot} onChange={(e) => loadGuilds(e.target.value)}
                className="border rounded px-2 py-1 text-sm">
                <option value="">--</option>
                {gatewayBots.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
              <span className="text-xs text-gray-400 ml-2">仅 Gateway 模式支持</span>
            </div>
          )}
          {!gatewayBots.length && <div className="text-center text-gray-500 py-8">暂无 Gateway 模式在线机器人</div>}
          {guildsLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>}

          {!guildsLoading && guilds.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {guilds.map(g => (
                <div key={g.id} className="border rounded-lg p-3 bg-card shadow-sm flex items-center gap-3">
                  {g.icon
                    ? <img src={g.icon} alt="" className="w-10 h-10 rounded-full" />
                    : <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-500 font-bold text-sm">{g.name[0]}</div>}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{g.name}</div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Users className="w-3 h-3" /> {g.memberCount} 成员
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!guildsLoading && selectedBot && !guilds.length && <div className="text-center text-gray-400 py-8">该机器人未加入任何服务器</div>}
        </div>
      )}
    </div>
  )
}
