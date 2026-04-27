import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Hash, MessageSquare, User, Users } from 'lucide-react'
import { useWebSocket } from '@zhin.js/client'
import type {
  BotInfo,
  ChatRow,
  InboxMessageRow,
  InboxNoticeRow,
  InboxRequestRow,
  MemberRow,
  NoticeItem,
  ReceivedMessage,
  ReqItem,
  SidebarSelection,
} from './types'
import {
  hasRenderableComposerSegments,
  normalizeInboundContent,
  parseComposerToSegments,
  type MessageContent,
} from '../../utils/parseComposerContent'

export function useBotConsole() {
  const { adapter: adapterParam, botId: botIdParam } = useParams<{
    adapter: string
    botId: string
  }>()
  const adapter = adapterParam ? decodeURIComponent(adapterParam) : ''
  const botId = botIdParam ? decodeURIComponent(botIdParam) : ''
  const valid = Boolean(adapter && botId)

  const { sendRequest, connected } = useWebSocket()
  const [info, setInfo] = useState<BotInfo | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [msgContent, setMsgContent] = useState('')
  const [sending, setSending] = useState(false)

  const [friends, setFriends] = useState<Array<{ user_id: number; nickname: string; remark: string }>>([])
  const [groups, setGroups] = useState<Array<{ group_id: number; name: string }>>([])
  const [channelList, setChannelList] = useState<Array<{ id: string; name: string }>>([])
  const [listLoading, setListLoading] = useState(false)
  const [listErr, setListErr] = useState<string | null>(null)

  const [requests, setRequests] = useState<Map<number, ReqItem>>(new Map())
  const [notices, setNotices] = useState<Map<number, NoticeItem>>(new Map())

  const [selection, setSelection] = useState<SidebarSelection | null>(null)
  const [showChannelList, setShowChannelList] = useState(false)
  const [listSearch, setListSearch] = useState('')

  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([])
  const [localSent, setLocalSent] = useState<
    Array<{
      id: string
      channelId: string
      channelType: string
      segments: MessageContent
      timestamp: number
    }>
  >([])
  const [inboxMessages, setInboxMessages] = useState<InboxMessageRow[]>([])
  const [inboxMessagesLoading, setInboxMessagesLoading] = useState(false)
  const [inboxMessagesHasMore, setInboxMessagesHasMore] = useState(true)
  const [inboxMessagesEnabled, setInboxMessagesEnabled] = useState(false)
  const [inboxRequests, setInboxRequests] = useState<InboxRequestRow[]>([])
  const [inboxRequestsLoading, setInboxRequestsLoading] = useState(false)
  const [inboxRequestsOffset, setInboxRequestsOffset] = useState(0)
  const [inboxRequestsEnabled, setInboxRequestsEnabled] = useState(false)
  const [inboxNotices, setInboxNotices] = useState<InboxNoticeRow[]>([])
  const [inboxNoticesLoading, setInboxNoticesLoading] = useState(false)
  const [inboxNoticesOffset, setInboxNoticesOffset] = useState(0)
  const [inboxNoticesEnabled, setInboxNoticesEnabled] = useState(false)
  const [requestsTab, setRequestsTab] = useState<'pending' | 'history'>('pending')
  const [noticesTab, setNoticesTab] = useState<'unread' | 'history'>('unread')

  const loadInfo = useCallback(async () => {
    if (!adapter || !botId || !connected) return
    try {
      const data = await sendRequest<BotInfo>({
        type: 'bot:info',
        data: { adapter, botId },
      })
      setInfo(data)
      setLoadErr(null)
    } catch (e) {
      setLoadErr((e as Error).message)
    }
  }, [adapter, botId, connected, sendRequest])

  useEffect(() => {
    loadInfo()
    const t = setInterval(loadInfo, 8000)
    return () => clearInterval(t)
  }, [loadInfo])

  const loadLists = useCallback(async () => {
    if (!adapter || !botId || !connected) return
    setListLoading(true)
    setListErr(null)
    try {
      if (adapter === 'icqq') {
        const f = await sendRequest<{ friends: typeof friends }>({
          type: 'bot:friends',
          data: { adapter, botId },
        }).catch(() => ({ friends: [] }))
        const g = await sendRequest<{ groups: typeof groups }>({
          type: 'bot:groups',
          data: { adapter, botId },
        }).catch(() => ({ groups: [] }))
        setFriends(f.friends || [])
        setGroups(g.groups || [])
        setChannelList([])
      } else {
        setFriends([])
        setGroups([])
        const ch = await sendRequest<{ channels?: Array<{ id: string; name: string }> }>({
          type: 'bot:channels',
          data: { adapter, botId },
        }).catch((): { channels?: Array<{ id: string; name: string }> } => ({}))
        const list = ch.channels ?? []
        setChannelList(list)
        if (!list.length) setListErr('当前适配器暂不支持好友/群/频道列表')
      }
    } catch (e) {
      setListErr((e as Error).message)
    } finally {
      setListLoading(false)
    }
  }, [adapter, botId, connected, sendRequest])

  useEffect(() => {
    if (connected) loadLists()
  }, [connected, loadLists])

  const loadRequestsFromServer = useCallback(async () => {
    if (!adapter || !botId || !connected) return
    try {
      const { requests: rows } = await sendRequest<{ requests: ReqItem[] }>({
        type: 'bot:requests',
        data: { adapter, botId },
      })
      setRequests((prev) => {
        const m = new Map(prev)
        for (const r of rows || []) {
          m.set(r.id, {
            ...r,
            canAct: false,
          })
        }
        return m
      })
    } catch {
      /* ignore */
    }
  }, [adapter, botId, connected, sendRequest])

  const loadInboxMessages = useCallback(
    async (beforeTs?: number) => {
      if (!adapter || !botId || selection?.type !== 'channel') return
      setInboxMessagesLoading(true)
      const append = beforeTs != null
      try {
        const res = await sendRequest<{ messages: InboxMessageRow[]; inboxEnabled: boolean }>({
          type: 'bot:inboxMessages',
          data: {
            adapter,
            botId,
            channelId: selection.id,
            channelType: selection.channelType,
            limit: 50,
            ...(beforeTs != null && { beforeTs }),
          },
        })
        setInboxMessagesEnabled(!!res.inboxEnabled)
        if (!res.inboxEnabled || !res.messages?.length) {
          if (!append) setInboxMessages([])
          setInboxMessagesHasMore(false)
          return
        }
        if (append) {
          setInboxMessages((prev) => [...prev, ...res.messages])
        } else {
          setInboxMessages(res.messages)
        }
        setInboxMessagesHasMore(res.messages.length >= 50)
      } catch {
        if (!append) setInboxMessages([])
        setInboxMessagesEnabled(false)
        setInboxMessagesHasMore(false)
      } finally {
        setInboxMessagesLoading(false)
      }
    },
    [adapter, botId, selection, sendRequest],
  )

  const loadInboxRequests = useCallback(
    async (append: boolean) => {
      if (!adapter || !botId) return
      setInboxRequestsLoading(true)
      try {
        const offset = append ? inboxRequestsOffset : 0
        const res = await sendRequest<{ requests: InboxRequestRow[]; inboxEnabled: boolean }>({
          type: 'bot:inboxRequests',
          data: { adapter, botId, limit: 30, offset },
        })
        setInboxRequestsEnabled(!!res.inboxEnabled)
        if (!res.inboxEnabled || !res.requests?.length) {
          if (!append) setInboxRequests([])
          return
        }
        if (append) {
          setInboxRequests((prev) => [...prev, ...res.requests])
        } else {
          setInboxRequests(res.requests)
        }
        setInboxRequestsOffset(offset + (res.requests?.length ?? 0))
      } catch {
        if (!append) setInboxRequests([])
        setInboxRequestsEnabled(false)
      } finally {
        setInboxRequestsLoading(false)
      }
    },
    [adapter, botId, inboxRequestsOffset, sendRequest],
  )

  const loadInboxNotices = useCallback(
    async (append: boolean) => {
      if (!adapter || !botId) return
      setInboxNoticesLoading(true)
      try {
        const offset = append ? inboxNoticesOffset : 0
        const res = await sendRequest<{ notices: InboxNoticeRow[]; inboxEnabled: boolean }>({
          type: 'bot:inboxNotices',
          data: { adapter, botId, limit: 30, offset },
        })
        setInboxNoticesEnabled(!!res.inboxEnabled)
        if (!res.inboxEnabled || !res.notices?.length) {
          if (!append) setInboxNotices([])
          return
        }
        if (append) {
          setInboxNotices((prev) => [...prev, ...res.notices])
        } else {
          setInboxNotices(res.notices)
        }
        setInboxNoticesOffset(offset + res.notices.length)
      } catch {
        if (!append) setInboxNotices([])
        setInboxNoticesEnabled(false)
      } finally {
        setInboxNoticesLoading(false)
      }
    },
    [adapter, botId, inboxNoticesOffset, sendRequest],
  )

  useEffect(() => {
    loadRequestsFromServer()
  }, [loadRequestsFromServer])

  useEffect(() => {
    if (selection?.type === 'channel') {
      setInboxMessages([])
      setInboxMessagesHasMore(true)
      void loadInboxMessages()
    }
  }, [selection?.id, selection?.channelType, selection?.type, loadInboxMessages])

  useEffect(() => {
    const onPush = (ev: Event) => {
      const msg = (ev as CustomEvent).detail as {
        type: string
        data: Record<string, unknown>
      }
      const d = msg.data
      if (msg.type === 'bot:request') {
        if (d.adapter === adapter && d.botId === botId) {
          setRequests((prev) => {
            const m = new Map(prev)
            m.set(d.id as number, {
              id: d.id as number,
              platformRequestId: String(d.platformRequestId),
              type: String(d.type),
              sender: d.sender as ReqItem['sender'],
              comment: String(d.comment ?? ''),
              channel: d.channel as ReqItem['channel'],
              timestamp: Number(d.timestamp),
              canAct: d.canAct === true,
            })
            return m
          })
        }
      } else if (msg.type === 'bot:notice') {
        if (d.adapter === adapter && d.botId === botId) {
          setNotices((prev) => {
            const m = new Map(prev)
            m.set(d.id as number, {
              id: d.id as number,
              noticeType: String(d.noticeType),
              channel: d.channel as NoticeItem['channel'],
              payload: String(d.payload ?? '{}'),
              timestamp: Number(d.timestamp),
            })
            return m
          })
        }
      } else if (msg.type === 'bot:message') {
        if (d.adapter === adapter && d.botId === botId) {
          const content = normalizeInboundContent(d.content) as ReceivedMessage['content']
          setReceivedMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              channelId: String(d.channelId ?? ''),
              channelType: String(d.channelType ?? 'private'),
              sender: (d.sender as ReceivedMessage['sender']) ?? { id: '', name: '' },
              content,
              timestamp: Number(d.timestamp ?? Date.now()),
            },
          ])
        }
      }
    }
    window.addEventListener('zhin-console-bot-push', onPush as EventListener)
    return () => window.removeEventListener('zhin-console-bot-push', onPush as EventListener)
  }, [adapter, botId])

  const requestList = useMemo(() => [...requests.values()].sort((a, b) => b.timestamp - a.timestamp), [requests])
  const noticeList = useMemo(() => [...notices.values()].sort((a, b) => b.timestamp - a.timestamp), [notices])

  const channels = useMemo(() => {
    const list: Array<{ id: string; name: string; channelType: 'private' | 'group' | 'channel' }> = []
    friends.forEach((f) => {
      list.push({
        id: String(f.user_id),
        name: f.nickname || f.remark || f.user_id.toString(),
        channelType: 'private',
      })
    })
    groups.forEach((g) => {
      list.push({ id: String(g.group_id), name: g.name || String(g.group_id), channelType: 'group' })
    })
    channelList.forEach((c) => {
      list.push({ id: c.id, name: c.name || c.id, channelType: 'channel' })
    })
    return list
  }, [friends, groups, channelList])

  const filteredChannels = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((ch) => ch.name.toLowerCase().includes(q) || ch.id.toLowerCase().includes(q))
  }, [channels, listSearch])

  const channelMessages = useMemo((): ChatRow[] => {
    if (selection?.type !== 'channel') return []
    const fromInbox: ChatRow[] = inboxMessages
      .filter((m) => selection.id && selection.channelType)
      .map((m) => {
        const content = normalizeInboundContent(m.content) as ReceivedMessage['content']
        return {
          id: `inbox-${m.id}`,
          channelId: selection.id,
          channelType: selection.channelType,
          sender: { id: m.sender_id, name: m.sender_name ?? undefined },
          content,
          timestamp: m.created_at,
          outgoing: false,
        }
      })
    const fromRealtime: ChatRow[] = receivedMessages
      .filter((m) => m.channelId === selection.id && m.channelType === selection.channelType)
      .map((m) => ({ ...m, outgoing: false }))
    const outbound: ChatRow[] = localSent
      .filter((m) => m.channelId === selection.id && m.channelType === selection.channelType)
      .map((m) => ({
        id: m.id,
        channelId: m.channelId,
        channelType: m.channelType,
        sender: { id: 'self', name: '我' },
        content: m.segments as ReceivedMessage['content'],
        timestamp: m.timestamp,
        outgoing: true,
      }))
    return [...fromInbox, ...fromRealtime, ...outbound].sort((a, b) => a.timestamp - b.timestamp)
  }, [selection, receivedMessages, inboxMessages, localSent])

  const deleteFriend = async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'private') return
    if (!confirm(`确定删除好友 ${selection.name}？`)) return
    try {
      await sendRequest({
        type: 'bot:deleteFriend',
        data: { adapter, botId, userId: selection.id },
      })
      setFriends((prev) => prev.filter((f) => String(f.user_id) !== selection.id))
      setSelection(null)
      loadLists()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const handleSend = async () => {
    const targetId = selection?.type === 'channel' ? selection.id : ''
    const msgType = selection?.type === 'channel' ? selection.channelType : 'private'
    const segments = parseComposerToSegments(msgContent)
    if (!targetId || !hasRenderableComposerSegments(segments)) return
    setSending(true)
    try {
      await sendRequest({
        type: 'bot:sendMessage',
        data: {
          adapter,
          botId,
          id: targetId,
          type: msgType,
          content: segments,
        },
      })
      setLocalSent((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          channelId: targetId,
          channelType: msgType,
          segments,
          timestamp: Date.now(),
        },
      ])
      setMsgContent('')
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const approve = async (platformRequestId: string, approveIt: boolean) => {
    try {
      await sendRequest({
        type: approveIt ? 'bot:requestApprove' : 'bot:requestReject',
        data: { adapter, botId, requestId: platformRequestId },
      })
      const row = requestList.find((r) => r.platformRequestId === platformRequestId)
      if (row) {
        setRequests((prev) => {
          const m = new Map(prev)
          m.delete(row.id)
          return m
        })
      }
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const dismissRequest = async (id: number) => {
    try {
      await sendRequest({ type: 'bot:requestConsumed', data: { id } })
      setRequests((prev) => {
        const m = new Map(prev)
        m.delete(id)
        return m
      })
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const dismissNotice = async (id: number) => {
    try {
      await sendRequest({ type: 'bot:noticeConsumed', data: { id } })
      setNotices((prev) => {
        const m = new Map(prev)
        m.delete(id)
        return m
      })
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const loadMembers = async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'group' || adapter !== 'icqq') return
    setMembersLoading(true)
    try {
      const r = await sendRequest<{ members: MemberRow[] }>({
        type: 'bot:groupMembers',
        data: { adapter, botId, groupId: selection.id },
      })
      setMembers(r.members || [])
    } catch (e) {
      alert((e as Error).message)
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }

  const groupAction = async (
    type: 'bot:groupKick' | 'bot:groupMute' | 'bot:groupAdmin',
    userId: number | string,
    extra?: { enable?: boolean },
  ) => {
    if (selection?.type !== 'channel' || selection.channelType !== 'group') return
    try {
      await sendRequest({
        type,
        data: {
          adapter,
          botId,
          groupId: selection.id,
          userId: String(userId),
          ...extra,
        },
      })
      await loadMembers()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const getChannelIcon = (channelType: string): ReactNode => {
    switch (channelType) {
      case 'private':
        return <User size={16} />
      case 'group':
        return <Users size={16} />
      case 'channel':
        return <Hash size={16} />
      default:
        return <MessageSquare size={16} />
    }
  }

  const showRightPanel =
    selection?.type === 'channel' && selection.channelType === 'group' && adapter === 'icqq'

  return {
    valid,
    adapter,
    botId,
    connected,
    info,
    loadErr,
    msgContent,
    setMsgContent,
    sending,
    listLoading,
    listErr,
    selection,
    setSelection,
    showChannelList,
    setShowChannelList,
    listSearch,
    setListSearch,
    members,
    membersLoading,
    channelMessages,
    inboxMessagesLoading,
    inboxMessagesHasMore,
    inboxMessagesEnabled,
    loadInboxMessages,
    inboxMessages,
    requestList,
    noticeList,
    requestsTab,
    setRequestsTab,
    noticesTab,
    setNoticesTab,
    inboxRequests,
    inboxRequestsLoading,
    inboxRequestsEnabled,
    loadInboxRequests,
    inboxNotices,
    inboxNoticesLoading,
    inboxNoticesEnabled,
    loadInboxNotices,
    channels,
    filteredChannels,
    deleteFriend,
    handleSend,
    approve,
    dismissRequest,
    dismissNotice,
    loadMembers,
    groupAction,
    loadLists,
    loadRequestsFromServer,
    getChannelIcon,
    showRightPanel,
  }
}
