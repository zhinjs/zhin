import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from './utils/api'
import { RefreshCw, Server, Wifi, WifiOff, Power, PowerOff, Loader2, Shield, Plus, Trash2, X } from 'lucide-react'

interface BotInfo {
  name: string
  connected: boolean
  guildCount: number
  status: string
}

interface Role {
  id: string
  name: string
  color: number
  position: number
}

type Tab = 'overview' | 'roles'

export default function KookDashboard() {
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  // Role management state
  const [selectedBot, setSelectedBot] = useState('')
  const [guildId, setGuildId] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/kook/bots')
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
      const res = await apiFetch(`/api/kook/bots/${encodeURIComponent(name)}/${endpoint}`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) setError(json.error || '操作失败')
      await fetchData()
    } catch {
      setError('操作失败')
    } finally {
      setActionLoading(prev => ({ ...prev, [name]: false }))
    }
  }

  const loadRoles = async () => {
    if (!selectedBot || !guildId) return
    setRolesLoading(true)
    setRoles([])
    try {
      const res = await apiFetch(`/api/kook/bots/${encodeURIComponent(selectedBot)}/guilds/${encodeURIComponent(guildId)}/roles`)
      const json = await res.json()
      if (json.success) setRoles(json.data)
      else setError(json.error || '获取角色失败')
    } catch {
      setError('获取角色失败')
    } finally {
      setRolesLoading(false)
    }
  }

  const createRole = async () => {
    if (!selectedBot || !guildId || !newRoleName.trim()) return
    setCreateLoading(true)
    try {
      const res = await apiFetch(`/api/kook/bots/${encodeURIComponent(selectedBot)}/guilds/${encodeURIComponent(guildId)}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoleName.trim() }),
      })
      const json = await res.json()
      if (json.success) {
        setNewRoleName('')
        await loadRoles()
      } else {
        setError(json.error || '创建角色失败')
      }
    } catch {
      setError('创建角色失败')
    } finally {
      setCreateLoading(false)
    }
  }

  const deleteRole = async (roleId: string) => {
    if (!selectedBot || !guildId) return
    setDeleteLoading(roleId)
    try {
      const res = await apiFetch(`/api/kook/bots/${encodeURIComponent(selectedBot)}/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (json.success) {
        setRoles(prev => prev.filter(r => r.id !== roleId))
      } else {
        setError(json.error || '删除角色失败')
      }
    } catch {
      setError('删除角色失败')
    } finally {
      setDeleteLoading(null)
    }
  }

  const onlineBots = bots.filter(b => b.connected)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Server className="w-6 h-6" /> KOOK 机器人
        </h1>
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded border border-red-200 flex items-center justify-between">
        <span>{error}</span>
        <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
      </div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button onClick={() => setTab('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'overview' ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          概览
        </button>
        <button onClick={() => setTab('roles')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'roles' ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          角色管理
        </button>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <>
          {!loading && !bots.length && !error && (
            <div className="text-center text-gray-500 py-12">暂无 KOOK 机器人实例</div>
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
                <div className="text-sm text-gray-600 mb-3">
                  <div className="flex justify-between"><span>服务器</span><span className="font-mono">{bot.guildCount}</span></div>
                </div>
                <button
                  onClick={() => toggleConnect(bot.name, bot.connected)}
                  disabled={actionLoading[bot.name]}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm text-white ${bot.connected ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} disabled:opacity-50`}>
                  {actionLoading[bot.name]
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : bot.connected ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                  {bot.connected ? '断开' : '连接'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Roles Tab */}
      {tab === 'roles' && (
        <div className="space-y-4">
          {/* Bot + Guild selector */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">机器人</label>
              <select value={selectedBot} onChange={(e) => setSelectedBot(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[140px]">
                <option value="">--</option>
                {onlineBots.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">服务器 ID</label>
              <input value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="输入服务器 ID"
                className="border rounded px-2 py-1.5 text-sm w-[180px]" />
            </div>
            <button onClick={loadRoles} disabled={!selectedBot || !guildId || rolesLoading}
              className="px-3 py-1.5 rounded bg-sky-500 text-white text-sm hover:bg-sky-600 disabled:opacity-50 flex items-center gap-1">
              {rolesLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />} 查询角色
            </button>
          </div>

          {!onlineBots.length && <div className="text-center text-gray-500 py-4">暂无在线机器人</div>}

          {/* Create Role */}
          {selectedBot && guildId && roles.length > 0 && (
            <div className="flex items-center gap-2">
              <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="新角色名称"
                className="border rounded px-2 py-1.5 text-sm flex-1 max-w-[240px]"
                onKeyDown={(e) => e.key === 'Enter' && createRole()} />
              <button onClick={createRole} disabled={createLoading || !newRoleName.trim()}
                className="px-3 py-1.5 rounded bg-green-500 text-white text-sm hover:bg-green-600 disabled:opacity-50 flex items-center gap-1">
                {createLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 创建
              </button>
            </div>
          )}

          {/* Roles list */}
          {rolesLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-sky-500" /></div>}

          {!rolesLoading && roles.length > 0 && (
            <div className="border rounded-lg bg-card shadow-sm divide-y">
              {roles.map(role => (
                <div key={role.id} className="flex items-center px-4 py-2.5 hover:bg-gray-50">
                  <div className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#999' }} />
                  <span className="font-medium text-sm flex-1">{role.name}</span>
                  <span className="text-xs text-gray-400 mr-4">ID: {role.id}</span>
                  <button onClick={() => deleteRole(role.id)} disabled={deleteLoading === role.id}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-50">
                    {deleteLoading === role.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {!rolesLoading && selectedBot && guildId && !roles.length && <div className="text-center text-gray-400 py-6">暂无角色数据，请先查询</div>}
        </div>
      )}
    </div>
  )
}
