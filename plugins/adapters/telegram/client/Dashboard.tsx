import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from './utils/api'
import { RefreshCw, Server, Wifi, WifiOff, Power, PowerOff, Loader2, Link2, BarChart3, ShieldCheck, Plus, X } from 'lucide-react'

interface BotInfo {
  name: string
  connected: boolean
  mode: string
  status: string
  botInfo: { username: string; firstName: string } | null
}

interface Admin {
  user_id: number
  username: string
  first_name: string
  status: string
}

type Tab = 'overview' | 'actions'

export default function TelegramDashboard() {
  const [bots, setBots] = useState<BotInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  // Quick actions state
  const [selectedBot, setSelectedBot] = useState('')
  const [chatId, setChatId] = useState('')
  const [inviteResult, setInviteResult] = useState('')
  const [admins, setAdmins] = useState<Admin[]>([])
  const [adminsLoading, setAdminsLoading] = useState(false)

  // Poll state
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollAnonymous, setPollAnonymous] = useState(true)
  const [pollMultiple, setPollMultiple] = useState(false)
  const [pollResult, setPollResult] = useState('')
  const [pollLoading, setPollLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/telegram/bots')
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
      const res = await apiFetch(`/api/telegram/bots/${encodeURIComponent(name)}/${endpoint}`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) setError(json.error || '操作失败')
      await fetchData()
    } catch {
      setError('操作失败')
    } finally {
      setActionLoading(prev => ({ ...prev, [name]: false }))
    }
  }

  const createInvite = async () => {
    if (!selectedBot || !chatId) return
    setInviteResult('')
    try {
      const res = await apiFetch(`/api/telegram/bots/${encodeURIComponent(selectedBot)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId }),
      })
      const json = await res.json()
      if (json.success && json.data?.invite_link) setInviteResult(json.data.invite_link)
      else setError(json.error || '创建失败')
    } catch {
      setError('创建邀请链接失败')
    }
  }

  const fetchAdmins = async () => {
    if (!selectedBot || !chatId) return
    setAdminsLoading(true)
    setAdmins([])
    try {
      const res = await apiFetch(`/api/telegram/bots/${encodeURIComponent(selectedBot)}/admins?chat_id=${encodeURIComponent(chatId)}`)
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) setAdmins(json.data)
      else setError(json.error || '获取管理员失败')
    } catch {
      setError('获取管理员失败')
    } finally {
      setAdminsLoading(false)
    }
  }

  const sendPoll = async () => {
    if (!selectedBot || !chatId || !pollQuestion) return
    const validOptions = pollOptions.filter(o => o.trim())
    if (validOptions.length < 2) { setError('至少需要 2 个选项'); return }
    setPollLoading(true)
    setPollResult('')
    try {
      const res = await apiFetch(`/api/telegram/bots/${encodeURIComponent(selectedBot)}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, question: pollQuestion, options: validOptions, is_anonymous: pollAnonymous, allows_multiple: pollMultiple }),
      })
      const json = await res.json()
      if (json.success) setPollResult(`投票已发送 (ID: ${json.data?.message_id ?? '未知'})`)
      else setError(json.error || '发送失败')
    } catch {
      setError('发送投票失败')
    } finally {
      setPollLoading(false)
    }
  }

  const onlineBots = bots.filter(b => b.connected)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Server className="w-6 h-6" /> Telegram 机器人
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
        <button onClick={() => setTab('actions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'actions' ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          快捷操作
        </button>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <>
          {!loading && !bots.length && !error && (
            <div className="text-center text-gray-500 py-12">暂无 Telegram 机器人实例</div>
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
                {bot.botInfo && <div className="text-sm text-gray-500 mb-2">@{bot.botInfo.username} ({bot.botInfo.firstName})</div>}
                <div className="text-sm text-gray-600 mb-3">
                  <div className="flex justify-between"><span>模式</span><span className="font-mono">{bot.mode}</span></div>
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

      {/* Quick Actions Tab */}
      {tab === 'actions' && (
        <div className="space-y-6">
          {/* Bot + Chat selector */}
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
              <label className="block text-xs text-gray-500 mb-1">Chat ID</label>
              <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100xxxxxxxxxx"
                className="border rounded px-2 py-1.5 text-sm w-[180px]" />
            </div>
          </div>

          {!onlineBots.length && <div className="text-center text-gray-500 py-4">暂无在线机器人</div>}

          {selectedBot && chatId && (
            <div className="grid gap-4 md:grid-cols-2">
              {/* Invite Link */}
              <div className="border rounded-lg p-4 bg-card shadow-sm">
                <h3 className="font-medium flex items-center gap-2 mb-3"><Link2 className="w-4 h-4 text-sky-500" /> 创建邀请链接</h3>
                <button onClick={createInvite} className="px-3 py-1.5 rounded bg-sky-500 text-white text-sm hover:bg-sky-600">
                  生成链接
                </button>
                {inviteResult && (
                  <div className="mt-2 p-2 bg-gray-50 rounded text-sm break-all">
                    <a href={inviteResult} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">{inviteResult}</a>
                  </div>
                )}
              </div>

              {/* Admin List */}
              <div className="border rounded-lg p-4 bg-card shadow-sm">
                <h3 className="font-medium flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-sky-500" /> 管理员列表</h3>
                <button onClick={fetchAdmins} disabled={adminsLoading}
                  className="px-3 py-1.5 rounded bg-sky-500 text-white text-sm hover:bg-sky-600 disabled:opacity-50 flex items-center gap-1">
                  {adminsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 查询
                </button>
                {admins.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {admins.map(a => (
                      <div key={a.user_id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                        <span>{a.first_name} {a.username ? `(@${a.username})` : ''}</span>
                        <span className="text-xs text-gray-400">{a.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Send Poll */}
              <div className="border rounded-lg p-4 bg-card shadow-sm md:col-span-2">
                <h3 className="font-medium flex items-center gap-2 mb-3"><BarChart3 className="w-4 h-4 text-sky-500" /> 发起投票</h3>
                <div className="space-y-2">
                  <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="投票问题"
                    className="border rounded px-2 py-1.5 text-sm w-full" />
                  {pollOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={opt} onChange={(e) => {
                        const next = [...pollOptions]; next[i] = e.target.value; setPollOptions(next)
                      }} placeholder={`选项 ${i + 1}`}
                        className="border rounded px-2 py-1.5 text-sm flex-1" />
                      {pollOptions.length > 2 && (
                        <button onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                          className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setPollOptions([...pollOptions, ''])}
                    className="flex items-center gap-1 text-sm text-sky-500 hover:text-sky-600">
                    <Plus className="w-3.5 h-3.5" /> 添加选项
                  </button>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={pollAnonymous} onChange={(e) => setPollAnonymous(e.target.checked)} /> 匿名
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={pollMultiple} onChange={(e) => setPollMultiple(e.target.checked)} /> 多选
                    </label>
                  </div>
                  <button onClick={sendPoll} disabled={pollLoading || !pollQuestion}
                    className="px-3 py-1.5 rounded bg-sky-500 text-white text-sm hover:bg-sky-600 disabled:opacity-50 flex items-center gap-1">
                    {pollLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 发送投票
                  </button>
                  {pollResult && <div className="text-sm text-green-600">{pollResult}</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
