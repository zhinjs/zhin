import { Fragment, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowLeft,
  Bell,
  Bot,
  Check,
  Image,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Music,
  Send,
  UserMinus,
  UserPlus,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { MessageBody } from './MessageBody'
import { useBotConsole } from './useBotConsole'
import { hasRenderableComposerSegments, parseComposerToSegments } from '../../utils/parseComposerContent'
import { dayKey, dayLabel } from './date-utils'

export default function BotDetailPage() {
  const ctx = useBotConsole()

  if (!ctx.valid) {
    return (
      <div className="p-4">
        <Alert>
          <AlertDescription>参数无效</AlertDescription>
        </Alert>
      </div>
    )
  }

  const {
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
  } = ctx

  const [mediaPanel, setMediaPanel] = useState<null | 'image' | 'video' | 'audio'>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const imageFileRef = useRef<HTMLInputElement>(null)

  const appendComposerToken = (token: string) => {
    setMsgContent((c) => {
      if (!c) return token
      const needsSpace = !/\s$/.test(c) && !/^[\s[,]/.test(token)
      return c + (needsSpace ? ' ' : '') + token
    })
  }

  const commitMediaUrl = () => {
    const u = mediaUrl.trim()
    if (!u || !mediaPanel) return
    const tag =
      mediaPanel === 'image' ? `[image:${u}]` : mediaPanel === 'video' ? `[video:${u}]` : `[audio:${u}]`
    appendComposerToken(tag)
    setMediaUrl('')
    setMediaPanel(null)
  }

  const onPickImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f?.type.startsWith('image/')) return
    const r = new FileReader()
    r.onload = () => {
      const dataUrl = String(r.result || '')
      if (dataUrl) appendComposerToken(`[image:${dataUrl}]`)
    }
    r.readAsDataURL(f)
  }

  const canSend = connected && !sending && hasRenderableComposerSegments(parseComposerToSegments(msgContent))

  let lastDay = ''

  return (
    <div className="sandbox-container im-layout">
      <button
        type="button"
        className="mobile-channel-toggle md:hidden"
        onClick={() => setShowChannelList(!showChannelList)}
      >
        <MessageSquare size={20} /> 会话列表
      </button>

      <div className={cn('channel-sidebar', showChannelList && 'show')}>
        <div className="p-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
              <Link to="/bots">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-semibold truncate text-sm">{info?.name || botId}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1 font-normal">
                  {adapter}
                </Badge>
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0 rounded-full border',
                    connected
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
                  {connected ? '已连接' : '未连接'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {loadErr && (
          <div className="px-3 py-2">
            <p className="text-xs text-destructive">{loadErr}</p>
          </div>
        )}

        <div className="px-2 pt-2 pb-1">
          <Input
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="搜索会话…"
            className="h-9 text-sm bg-background/80"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0">
          {listLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!listLoading && listErr && <p className="text-xs text-muted-foreground px-2 py-1">{listErr}</p>}
          {filteredChannels.length === 0 && !listLoading && !listErr && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              {listSearch.trim() ? `无匹配「${listSearch.trim()}」` : '暂无会话'}
            </p>
          )}
          {filteredChannels.map((ch) => {
            const isActive = selection?.type === 'channel' && selection.id === ch.id
            return (
              <div
                key={`${ch.channelType}-${ch.id}`}
                role="button"
                tabIndex={0}
                className={cn('menu-item im-row-compact', isActive && 'active')}
                onClick={() => {
                  setSelection({ type: 'channel', id: ch.id, name: ch.name, channelType: ch.channelType })
                  if (typeof window !== 'undefined' && window.innerWidth < 768) setShowChannelList(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelection({ type: 'channel', id: ch.id, name: ch.name, channelType: ch.channelType })
                    if (typeof window !== 'undefined' && window.innerWidth < 768) setShowChannelList(false)
                  }
                }}
              >
                <span className="shrink-0 opacity-90">{getChannelIcon(ch.channelType)}</span>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate leading-tight">{ch.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {ch.channelType === 'private' ? '私聊' : ch.channelType === 'group' ? '群聊' : '频道'}
                  </div>
                </div>
              </div>
            )
          })}

          <div className="pt-2 mt-2 border-t border-border/50 space-y-0.5">
            <div
              role="button"
              tabIndex={0}
              className={cn('menu-item im-row-compact', selection?.type === 'requests' && 'active')}
              onClick={() => {
                setSelection({ type: 'requests' })
                if (typeof window !== 'undefined' && window.innerWidth < 768) setShowChannelList(false)
              }}
            >
              <UserPlus size={16} className="shrink-0" />
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium">请求</div>
                <div className="text-[11px] text-muted-foreground">好友/群邀请</div>
              </div>
              {requestList.length > 0 && (
                <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1">
                  {requestList.length}
                </span>
              )}
            </div>
            <div
              role="button"
              tabIndex={0}
              className={cn('menu-item im-row-compact', selection?.type === 'notices' && 'active')}
              onClick={() => {
                setSelection({ type: 'notices' })
                if (typeof window !== 'undefined' && window.innerWidth < 768) setShowChannelList(false)
              }}
            >
              <Bell size={16} className="shrink-0" />
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium">通知</div>
                <div className="text-[11px] text-muted-foreground">群管/撤回等</div>
              </div>
              {noticeList.length > 0 && (
                <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1">
                  {noticeList.length}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-2 border-t border-border/60">
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-xs h-8"
            onClick={() => void loadLists()}
            disabled={listLoading || !connected}
          >
            刷新好友/群
          </Button>
        </div>
      </div>

      {showChannelList && (
        <div
          className="channel-overlay md:hidden"
          onClick={() => setShowChannelList(false)}
          aria-hidden
        />
      )}

      <div className="im-main-split">
        <div className="im-center">
          {selection?.type === 'channel' && (
            <>
              <header className="im-chat-header px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-full bg-muted/80 text-muted-foreground shrink-0">
                    {getChannelIcon(selection.channelType)}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold truncate leading-tight">{selection.name}</h2>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {selection.channelType === 'private' ? '私聊' : selection.channelType === 'group' ? '群聊' : '频道'}{' '}
                      · {selection.id}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {selection.channelType === 'private' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      title="删除好友"
                      onClick={() => void deleteFriend()}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 opacity-50" disabled title="更多">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0 flex flex-col">
                {inboxMessagesEnabled && inboxMessagesHasMore && (
                  <div className="flex-shrink-0 py-2 flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={inboxMessagesLoading}
                      onClick={() => {
                        const oldest = Math.min(...inboxMessages.map((m) => m.created_at))
                        void loadInboxMessages(oldest)
                      }}
                    >
                      {inboxMessagesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '加载更早消息'}
                    </Button>
                  </div>
                )}
                {channelMessages.length === 0 && !inboxMessagesLoading ? (
                  <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground text-sm py-12">
                    <MessageSquare className="h-10 w-10 opacity-35" />
                    <span>
                      {inboxMessagesEnabled ? '暂无消息' : '暂无消息，对方发送的消息会显示在此处'}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 pb-2">
                    {channelMessages.map((m) => {
                      const dk = dayKey(m.timestamp)
                      const showDate = dk !== lastDay
                      if (showDate) lastDay = dk
                      const out = m.outgoing === true
                      return (
                        <Fragment key={m.id}>
                          {showDate && <div className="im-date-pill">{dayLabel(m.timestamp)}</div>}
                          <div className={cn('flex w-full', out ? 'justify-end' : 'justify-start')}>
                            <div className={cn(out ? 'im-bubble-out' : 'im-bubble-in')}>
                              <div
                                className={cn(
                                  'im-meta flex items-center gap-2 text-[10px] mb-0.5',
                                  out ? '' : 'text-muted-foreground',
                                )}
                              >
                                <span className={cn('font-medium', out ? '' : 'text-foreground/90')}>
                                  {out ? '我' : m.sender?.name || m.sender?.id || '未知'}
                                </span>
                                <span className="tabular-nums opacity-80">
                                  {new Date(m.timestamp).toLocaleTimeString('zh-CN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <div className="text-[14px] leading-snug break-words">
                                <MessageBody content={m.content} />
                              </div>
                            </div>
                          </div>
                        </Fragment>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="im-composer p-3 shrink-0 space-y-2">
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickImageFile}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    title="选择本地图片（插入为 data URL）"
                    onClick={() => imageFileRef.current?.click()}
                  >
                    <Image className="w-3.5 h-3.5 mr-1" />
                    图片文件
                  </Button>
                  <Button
                    type="button"
                    variant={mediaPanel === 'image' ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setMediaPanel((p) => (p === 'image' ? null : 'image'))
                    }}
                  >
                    图片链接
                  </Button>
                  <Button
                    type="button"
                    variant={mediaPanel === 'video' ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setMediaPanel((p) => (p === 'video' ? null : 'video'))
                    }}
                  >
                    <Video className="w-3.5 h-3.5 mr-1" />
                    视频
                  </Button>
                  <Button
                    type="button"
                    variant={mediaPanel === 'audio' ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setMediaPanel((p) => (p === 'audio' ? null : 'audio'))
                    }}
                  >
                    <Music className="w-3.5 h-3.5 mr-1" />
                    音频
                  </Button>
                </div>
                {mediaPanel && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border border-border/80 bg-muted/20 p-2">
                    <Input
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder={
                        mediaPanel === 'image'
                          ? '图片 URL 或 base64://…'
                          : mediaPanel === 'video'
                            ? '视频直链 URL'
                            : '音频直链 URL'
                      }
                      className="flex-1 min-w-[12rem] h-9 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitMediaUrl()
                        }
                      }}
                    />
                    <Button type="button" size="sm" className="h-9" onClick={commitMediaUrl} disabled={!mediaUrl.trim()}>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      插入
                    </Button>
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <Textarea
                    placeholder="文字消息，或使用上方插入图片/音视频… 也可手写 [image:URL]、[video:URL]、[audio:URL]"
                    value={msgContent}
                    onChange={(e) => setMsgContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void handleSend()
                      }
                    }}
                    className="flex-1 min-h-[44px] max-h-[160px] text-sm resize-y bg-background font-mono text-[13px]"
                    rows={2}
                  />
                  <Button
                    className="shrink-0 h-10 w-10 p-0 rounded-full"
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Enter 发送 · Shift+Enter 换行 · 发送内容为消息段数组（含多媒体），由适配器实际发送
                </p>
              </div>
            </>
          )}

          {selection?.type === 'requests' && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-card m-0 border-0 rounded-none">
              <header className="im-chat-header px-4 py-3 flex items-center justify-between">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <UserPlus size={18} />
                  请求
                </h2>
                <Button size="sm" variant="outline" onClick={() => void loadRequestsFromServer()}>
                  刷新
                </Button>
              </header>
              <Tabs
                value={requestsTab}
                onValueChange={(v) => {
                  setRequestsTab(v as 'pending' | 'history')
                  if (v === 'history' && inboxRequests.length === 0 && !inboxRequestsLoading)
                    void loadInboxRequests(false)
                }}
                className="flex flex-col flex-1 min-h-0"
              >
                <TabsList className="mx-3 mt-2 w-auto justify-start">
                  <TabsTrigger value="pending">待处理</TabsTrigger>
                  <TabsTrigger value="history">历史</TabsTrigger>
                </TabsList>
                <TabsContent value="pending" className="flex-1 overflow-y-auto p-4 space-y-3 mt-0">
                  {requestList.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
                      <UserPlus size={40} className="opacity-25" />
                      <span>暂无未处理请求</span>
                    </div>
                  )}
                  {requestList.map((r) => (
                    <div key={r.id} className="border border-border/80 rounded-lg p-3 space-y-2 bg-background/50">
                      <div className="flex flex-wrap gap-2 text-sm">
                        <Badge>{r.type}</Badge>
                        <span>来自 {r.sender.name || r.sender.id}</span>
                        <span className="text-muted-foreground text-xs">
                          {new Date(r.timestamp).toLocaleString()}
                        </span>
                      </div>
                      {r.comment && <p className="text-sm">{r.comment}</p>}
                      <div className="flex flex-wrap gap-2">
                        {r.canAct === true && (
                          <>
                            <Button size="sm" onClick={() => void approve(r.platformRequestId, true)}>
                              同意
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void approve(r.platformRequestId, false)}>
                              拒绝
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void dismissRequest(r.id)}>
                          标记已处理
                        </Button>
                      </div>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="history" className="flex-1 overflow-y-auto p-4 space-y-3 mt-0 min-h-0">
                  {!inboxRequestsEnabled && !inboxRequestsLoading && (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>未启用统一收件箱，无历史记录</span>
                    </div>
                  )}
                  {inboxRequestsLoading && inboxRequests.length === 0 && (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {inboxRequestsEnabled && inboxRequests.length === 0 && !inboxRequestsLoading && (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>暂无请求历史</span>
                    </div>
                  )}
                  {inboxRequests.length > 0 && (
                    <>
                      {inboxRequests.map((r) => (
                        <div key={r.id} className="border border-border/80 rounded-lg p-3 space-y-1 text-sm bg-background/50">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{r.type}</Badge>
                            <span>{r.sender_name || r.sender_id}</span>
                            <span className="text-muted-foreground text-xs">
                              {new Date(r.created_at).toLocaleString()}
                            </span>
                            {r.resolved ? <Badge variant="secondary">已处理</Badge> : null}
                          </div>
                          {r.comment && <p className="text-muted-foreground text-sm">{r.comment}</p>}
                        </div>
                      ))}
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={inboxRequestsLoading}
                          onClick={() => void loadInboxRequests(true)}
                        >
                          {inboxRequestsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '加载更多'}
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {selection?.type === 'notices' && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-card m-0 border-0 rounded-none">
              <header className="im-chat-header px-4 py-3">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Bell size={18} />
                  通知
                </h2>
              </header>
              <Tabs
                value={noticesTab}
                onValueChange={(v) => {
                  setNoticesTab(v as 'unread' | 'history')
                  if (v === 'history' && inboxNotices.length === 0 && !inboxNoticesLoading)
                    void loadInboxNotices(false)
                }}
                className="flex flex-col flex-1 min-h-0"
              >
                <TabsList className="mx-3 mt-2 w-auto justify-start">
                  <TabsTrigger value="unread">未读</TabsTrigger>
                  <TabsTrigger value="history">历史</TabsTrigger>
                </TabsList>
                <TabsContent value="unread" className="flex-1 overflow-y-auto p-4 space-y-3 mt-0">
                  {noticeList.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
                      <Bell size={40} className="opacity-25" />
                      <span>暂无未读通知</span>
                    </div>
                  )}
                  {noticeList.map((n) => (
                    <div
                      key={n.id}
                      className="border border-border/80 rounded-lg p-3 flex justify-between gap-2 bg-background/50"
                    >
                      <div className="min-w-0">
                        <Badge className="mb-1">{n.noticeType}</Badge>
                        <p className="text-xs text-muted-foreground font-mono truncate max-w-md">
                          {n.payload.slice(0, 200)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(n.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => void dismissNotice(n.id)}>
                        已读
                      </Button>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="history" className="flex-1 overflow-y-auto p-4 space-y-3 mt-0 min-h-0">
                  {!inboxNoticesEnabled && !inboxNoticesLoading && (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>未启用统一收件箱，无历史记录</span>
                    </div>
                  )}
                  {inboxNoticesLoading && inboxNotices.length === 0 && (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {inboxNoticesEnabled && inboxNotices.length === 0 && !inboxNoticesLoading && (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>暂无通知历史</span>
                    </div>
                  )}
                  {inboxNotices.length > 0 && (
                    <>
                      {inboxNotices.map((n) => (
                        <div key={n.id} className="border border-border/80 rounded-lg p-3 space-y-1 text-sm bg-background/50">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{n.type}</Badge>
                            <span className="text-muted-foreground text-xs">
                              {new Date(n.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-muted-foreground font-mono text-xs truncate max-w-full">
                            {String(n.payload ?? '').slice(0, 200)}
                          </p>
                        </div>
                      ))}
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={inboxNoticesLoading}
                          onClick={() => void loadInboxNotices(true)}
                        >
                          {inboxNoticesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '加载更多'}
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {!selection && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground px-6 text-center">
              <MessageSquare className="h-14 w-14 opacity-20" />
              <p className="text-sm font-medium text-foreground/80">选择会话或查看请求 / 通知</p>
              <p className="text-xs max-w-sm">
                左侧列表与 Telegram Web 类似：点选好友或群开始聊天；请求与通知在列表下方分组。
              </p>
            </div>
          )}
        </div>

        {showRightPanel && (
          <aside className={cn('im-right-panel im-right-visible')}>
            <div className="p-3 border-b border-border/60">
              <h3 className="text-sm font-semibold">群成员与管理</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">仅 ICQQ 群聊</p>
            </div>
            <div className="p-2 border-b border-border/60">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => void loadMembers()}
                disabled={membersLoading}
              >
                {membersLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                加载成员
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
              {members.map((m, i) => {
                const uid = m.user_id ?? (m as { id?: string }).id ?? i
                return (
                  <div
                    key={`${uid}-${i}`}
                    className="flex flex-col gap-1.5 text-xs p-2 border border-border/70 rounded-md bg-background/60"
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="font-medium text-sm">
                        {m.nickname ?? (m as { name?: string }).name ?? uid}
                      </span>
                      <span className="text-muted-foreground">{uid}</span>
                      {(m.role ?? (m as { role?: string }).role) != null && (
                        <Badge variant="outline" className="text-[10px]">
                          {String(m.role ?? (m as { role?: string }).role)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-[10px] px-2"
                        onClick={() => void groupAction('bot:groupKick', uid)}
                      >
                        踢
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-2"
                        onClick={() => void groupAction('bot:groupMute', uid)}
                      >
                        禁言
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-2"
                        onClick={() => void groupAction('bot:groupAdmin', uid, { enable: true })}
                      >
                        管理
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
