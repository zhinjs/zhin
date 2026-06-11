import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from './utils/api'
import { RefreshCw, Server, Wifi, WifiOff, Power, PowerOff, Users, Loader2, Globe } from 'lucide-react'

interface EndpointRow {
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
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  // Guild browser state
  const [selectedEndpoint, setSelectedEndpoint] = useState('')
  const [guilds, setGuilds] = useState<GuildInfo[]>([])
  const [guildsLoading, setGuildsLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/discord/endpoints')
      const json = await res.json()
      if (json.success) setEndpoints(json.data)
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
      const res = await apiFetch(`/api/discord/endpoints/${encodeURIComponent(name)}/${endpoint}`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) setError(json.error || '操作失败')
      await fetchData()
    } catch {
      setError('操作失败')
    } finally {
      setActionLoading(prev => ({ ...prev, [name]: false }))
    }
  }

  const loadGuilds = async (endpointName: string) => {
    setSelectedEndpoint(endpointName)
    setGuildsLoading(true)
    setGuilds([])
    try {
      const res = await apiFetch(`/api/discord/endpoints/${encodeURIComponent(endpointName)}/guilds`)
      const json = await res.json()
      if (json.success) setGuilds(json.data)
      else setError(json.error || '获取服务器列表失败')
    } catch {
      setError('获取服务器列表失败')
    } finally {
      setGuildsLoading(false)
    }
  }

  const gatewayEndpoints = endpoints.filter((e) => e.connected && e.mode === 'gateway')

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
          {!loading && !endpoints.length && !error && (
            <div className="text-center text-gray-500 py-12">暂无 Discord Endpoint 实例</div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {endpoints.map((endpoint) => (
              <div key={endpoint.name} className="border rounded-lg p-4 bg-card shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-lg">{endpoint.name}</span>
                  {endpoint.connected
                    ? <span className="flex items-center gap-1 text-green-600 text-sm"><Wifi className="w-4 h-4" /> 在线</span>
                    : <span className="flex items-center gap-1 text-gray-400 text-sm"><WifiOff className="w-4 h-4" /> 离线</span>}
                </div>
                {endpoint.user && <div className="text-sm text-gray-500 mb-2">@{endpoint.user.tag}</div>}
                <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 mb-3">
                  <div className="flex justify-between"><span>模式</span><span className="font-mono">{endpoint.mode}</span></div>
                  <div className="flex justify-between"><span>服务器</span><span className="font-mono">{endpoint.guildCount}</span></div>
                  <div className="flex justify-between"><span>频道</span><span className="font-mono">{endpoint.channelCount}</span></div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleConnect(endpoint.name, endpoint.connected)}
                    disabled={actionLoading[endpoint.name]}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm text-white ${endpoint.connected ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} disabled:opacity-50`}>
                    {actionLoading[endpoint.name]
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : endpoint.connected ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    {endpoint.connected ? '断开' : '连接'}
                  </button>
                  {endpoint.connected && endpoint.mode === 'gateway' && (
                    <button onClick={() => { setTab('guilds'); loadGuilds(endpoint.name) }}
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
          {gatewayEndpoints.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <label className="text-sm text-gray-500">选择机器人：</label>
              <select value={selectedEndpoint} onChange={(e) => loadGuilds(e.target.value)}
                className="border rounded px-2 py-1 text-sm">
                <option value="">--</option>
                {gatewayEndpoints.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
              </select>
              <span className="text-xs text-gray-400 ml-2">仅 Gateway 模式支持</span>
            </div>
          )}
          {!gatewayEndpoints.length && <div className="text-center text-gray-500 py-8">暂无 Gateway 模式在线 Endpoint</div>}
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
          {!guildsLoading && selectedEndpoint && !guilds.length && <div className="text-center text-gray-400 py-8">该机器人未加入任何服务器</div>}
        </div>
      )}
    </div>
  )
}
