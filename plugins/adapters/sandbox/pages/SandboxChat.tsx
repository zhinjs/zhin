import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  cn,
  CodeBlock,
  MarkdownContent,
  resolveMediaSrc,
  pickMediaRawUrl,
  type MessageSegment,
} from '@zhin.js/client';
import { buildSandboxWebSocketUrl } from './sandboxTransport';
import {
  User, Bot, Users, Trash2, Send, Hash, MessageSquare,
  Wifi, WifiOff, Smile, Image, X, Check, Info, Search,
  Video, Music, Plus, PanelRight, ExternalLink, RefreshCw,
  Sparkles, Activity, Wrench, Coins, CircleAlert, Gauge,
  SlidersHorizontal, FolderOpen, ShieldCheck, Network,
  Square, RotateCcw, FileDiff, Terminal, FlaskConical, ChevronDown,
  FileDown, ListChecks,
} from 'lucide-react';
import RichTextEditor, { type RichTextEditorRef } from './RichTextEditor';
import {
  agentStudioPath,
  buildAgentRunReport,
  buildSandboxSessionKey,
  cancelAgentTask,
  deriveAgentRunSteps,
  deriveTaskRuns,
  deriveWorkbenchArtifacts,
  fetchAgentTrace,
  loadCachedAgentTrace,
  mergeTraceSnapshot,
  presentTraceEvent,
  summarizeTrace,
  saveCachedAgentTrace,
  type AgentTraceSnapshot,
  type SandboxScope,
} from './agentTrace.js';
import {
  createDefaultPlaygroundState,
  loadPlaygroundState,
  savePlaygroundState,
  type PlaygroundMessage,
  type PlaygroundSession,
} from './playgroundState.js';
import type { SandboxAgentRunConfig } from '../src/run-config.js';

type Message = PlaygroundMessage
type Channel = PlaygroundSession
interface Face { id: number; emojiId: number; stickerId: number; emojiType: string; name: string; describe: string; png: boolean; apng: boolean; lottie: boolean; }

export default function Sandbox() {
    const [initialState] = useState(() => loadPlaygroundState())
    const [messages, setMessages] = useState<Message[]>(() => [...initialState.messages])
    const [channels, setChannels] = useState<Channel[]>(() => [...initialState.sessions])
    const [faceList, setFaceList] = useState<Face[]>([])
    const [activeChannel, setActiveChannel] = useState<Channel>(() => (
        initialState.sessions.find((session) => session.id === initialState.activeSessionId && (
            initialState.activeSessionType === undefined || session.type === initialState.activeSessionType
        ))
        ?? initialState.sessions[0]
        ?? createDefaultPlaygroundState().sessions[0]!
    ))
    const [inputText, setInputText] = useState('')
    const [endpointId, setBotName] = useState('sandbox-bot')
    const [connected, setConnected] = useState(false)
    const [canExecute, setCanExecute] = useState(true)
    const [persistenceStatus, setPersistenceStatus] = useState<'saved' | 'error'>('saved')
    const [transportNotice, setTransportNotice] = useState<string | null>(null)
    const [shellIsolation, setShellIsolation] = useState<{ available: boolean; provider: string; message: string } | null>(null)
    const [inspectorView, setInspectorView] = useState<'runs' | 'artifacts'>('runs')
    const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null)
    const [stoppingTask, setStoppingTask] = useState(false)
    const [inlineRunExpanded, setInlineRunExpanded] = useState(false)
    const [showFacePicker, setShowFacePicker] = useState(false)
    /** 输入区：插入图片 / 视频 / 音频 URL */
    const [mediaPanel, setMediaPanel] = useState<null | 'image' | 'video' | 'audio'>(null)
    const [mediaUrl, setMediaUrl] = useState('')
    const [atPopoverPosition, setAtPopoverPosition] = useState<{ top: number; left: number } | null>(null)
    const [atSearchQuery, setAtSearchQuery] = useState('')
    const [faceSearchQuery, setFaceSearchQuery] = useState('')
    const [atSuggestions] = useState([
        { id: 'actor-owner', name: '当前用户' }, { id: 'actor-reviewer', name: '审阅者' },
        { id: 'actor-operator', name: '协作者' }, { id: 'actor-bot', name: 'Sandbox Agent' }
    ])
    const [previewSegments, setPreviewSegments] = useState<MessageSegment[]>([])
    const [composerMode, setComposerMode] = useState<'write' | 'preview'>('write')
    const [showChannelList, setShowChannelList] = useState(false)
    const [showInspector, setShowInspector] = useState(false)
    const [showRunSettings, setShowRunSettings] = useState(false)
    const [showNewSession, setShowNewSession] = useState(false)
    const [newSessionName, setNewSessionName] = useState('')
    const [newSessionScope, setNewSessionScope] = useState<SandboxScope>('private')
    const [confirmClear, setConfirmClear] = useState(false)
    const [trace, setTrace] = useState<AgentTraceSnapshot | null>(null)
    const [traceLoading, setTraceLoading] = useState(true)
    const [traceNotice, setTraceNotice] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const editorRef = useRef<RichTextEditorRef>(null)
    const traceRef = useRef<AgentTraceSnapshot | null>(null)
    const activeChannelRef = useRef(activeChannel)
    const endpointIdRef = useRef(endpointId)
    const sessionKey = useMemo(
        () => buildSandboxSessionKey(endpointId, activeChannel.type, activeChannel.id),
        [activeChannel.id, activeChannel.type, endpointId],
    )
    const traceSummary = useMemo(() => summarizeTrace(trace), [trace])
    const taskRuns = useMemo(() => deriveTaskRuns(trace), [trace])
    const workbenchArtifacts = useMemo(() => deriveWorkbenchArtifacts(trace), [trace])
    const currentTask = taskRuns.find((run) => run.status === 'running') ?? taskRuns[0]
    const currentRunSteps = useMemo(() => deriveAgentRunSteps(trace, currentTask), [currentTask, trace])
    const currentRunArtifacts = useMemo(
        () => workbenchArtifacts.filter((artifact) => (
            artifact.turnId === currentTask?.turnId && artifact.runtimeId === currentTask?.runtimeId
        )),
        [currentTask?.runtimeId, currentTask?.turnId, workbenchArtifacts],
    )

    useEffect(() => { activeChannelRef.current = activeChannel }, [activeChannel])
    useEffect(() => { endpointIdRef.current = endpointId }, [endpointId])
    useEffect(() => { setInlineRunExpanded(currentTask?.status === 'running') }, [currentTask?.id])
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [currentTask?.id])
    useEffect(() => {
        setPersistenceStatus(savePlaygroundState({
            activeSessionId: activeChannel.id,
            activeSessionType: activeChannel.type,
            sessions: channels,
            messages,
        }) ? 'saved' : 'error')
    }, [activeChannel.id, channels, messages])

    const fetchFaceList = async () => {
        try { const res = await fetch('https://face.viki.moe/metadata.json'); setFaceList(await res.json()) }
        catch (err) { console.error('[Sandbox] Failed to fetch face list:', err) }
    }

    useEffect(() => { fetchFaceList() }, [])

    const handleInboundPayload = (data: {
        type: string; id: string; content?: unknown; endpoint?: string; workingDirectory?: string; canExecute?: boolean;
        shellIsolation?: { available?: boolean; provider?: string; message?: string }; timestamp: number;
        messageId?: string; bot?: string;
    }) => {
        if (data.type === 'ready') {
            setBotName(data.endpoint || data.bot || 'sandbox-bot')
            setCanExecute(data.canExecute !== false)
            setTransportNotice(data.canExecute === false ? '当前 Token 只有演示权限，任务运行已禁用。' : null)
            if (data.shellIsolation) {
                setShellIsolation({
                    available: data.shellIsolation.available === true,
                    provider: data.shellIsolation.provider || 'docker',
                    message: data.shellIsolation.message || '未检测到隔离执行环境',
                })
            }
            if (data.workingDirectory?.trim()) {
                const workingDirectory = data.workingDirectory.trim()
                setChannels((current) => current.map((session) => session.runConfig.workingDirectory
                    ? session
                    : { ...session, runConfig: { ...session.runConfig, workingDirectory } }))
                setActiveChannel((current) => current.runConfig.workingDirectory
                    ? current
                    : { ...current, runConfig: { ...current.runConfig, workingDirectory } })
            }
            return
        }
        if (data.type === 'error') {
            const notice = Array.isArray(data.content)
                ? String((data.content[0] as { data?: { text?: unknown } } | undefined)?.data?.text ?? 'Sandbox 拒绝了本次操作')
                : String(data.content ?? 'Sandbox 拒绝了本次操作')
            setTransportNotice(notice)
            return
        }
        if (data.type === 'edit' && data.messageId) {
            const content: MessageSegment[] = Array.isArray(data.content)
                ? data.content as MessageSegment[]
                : parseTextToSegments(String(data.content ?? ''))
            setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, content } : m)))
            return
        }

        const content: MessageSegment[] = typeof data.content === 'string'
            ? parseTextToSegments(data.content)
            : Array.isArray(data.content) ? data.content as MessageSegment[] : parseTextToSegments(String(data.content ?? ''))

        const channelType: Channel['type'] = data.type === 'group' || data.type === 'channel' ? data.type : 'private'
        const channelName = channelType === 'private'
            ? `会话 ${data.id}`
            : channelType === 'group'
            ? `群组场景 ${data.id}`
            : `频道场景 ${data.id}`

        setChannels((prev) => {
            if (prev.some((c) => c.id === data.id && c.type === channelType)) return prev
            const created: Channel = {
                id: data.id, name: channelName, type: channelType, unread: 0,
                runConfig: { ...activeChannelRef.current.runConfig },
            }
            setActiveChannel(created)
            return [...prev, created]
        })

        setMessages((prev) => [...prev, {
            id: data.messageId ?? `bot_${data.timestamp}`, type: 'received', channelType,
            channelId: data.id, channelName, senderId: 'endpoint',
            senderName: data.bot || endpointIdRef.current, content, timestamp: data.timestamp,
        }])
    }

    const sendInteractiveAction = (payload: string, messageId?: string) => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setTransportNotice('Sandbox 连接尚未就绪，审批选择未发送。')
            return
        }
        const segments: MessageSegment[] = [{ type: 'action', data: { id: payload, payload } }]
        const payloadJson = JSON.stringify({
            type: activeChannel.type,
            id: activeChannel.id,
            content: segments,
            agentRun: activeChannel.runConfig,
            timestamp: Date.now(),
        })
        try {
            ws.send(payloadJson)
            if (messageId) {
                setMessages((current) => current.map((message) => message.id === messageId
                    ? { ...message, interactionResolved: true }
                    : message))
            }
        } catch {
            setTransportNotice('审批选择发送失败，请等待连接恢复后重试。')
        }
    }

    useEffect(() => {
        let closed = false
        let retryTimer: ReturnType<typeof setTimeout> | undefined
        let attempt = 0
        /** Ignore close events from a socket we intentionally replaced (login/base change). */
        let replaceInFlight = false

        const connect = () => {
            if (closed) return
            if (retryTimer) {
                clearTimeout(retryTimer)
                retryTimer = undefined
            }
            const wsUrl = buildSandboxWebSocketUrl()
            // Tear down previous socket before opening a new one so we don't
            // leave two concurrent /sandbox sessions for fixed-name endpoints.
            const previous = wsRef.current
            if (previous) {
                replaceInFlight = true
                previous.onclose = null
                previous.onerror = null
                previous.onmessage = null
                previous.onopen = null
                try { previous.close() } catch { /* already closed */ }
                replaceInFlight = false
            }
            const ws = new WebSocket(wsUrl)
            wsRef.current = ws
            ws.onopen = () => {
                attempt = 0
                setConnected(true)
            }
            ws.onmessage = (event) => {
                try { handleInboundPayload(JSON.parse(String(event.data))) }
                catch (err) { console.error('[Sandbox] Failed to parse message:', err) }
            }
            ws.onclose = () => {
                if (wsRef.current !== ws) return
                setConnected(false)
                wsRef.current = null
                if (closed || replaceInFlight) return
                const delay = Math.min(8_000, 500 * 2 ** attempt)
                attempt += 1
                retryTimer = setTimeout(connect, delay)
            }
            ws.onerror = () => {
                /* close handler reconnects */
            }
        }

        const onAuthOrStorage = (event?: Event) => {
            // storage fires for other tabs; same-tab login sets localStorage then
            // dispatches zhin:auth-required / custom login events.
            if (event && event.type === 'storage') {
                const key = (event as StorageEvent).key
                if (
                    key != null
                    && key !== 'zhin_api_token'
                    && key !== 'zhin_api_base'
                    && key !== 'HTTP_TOKEN'
                    && key !== 'zhin_http_token'
                ) {
                    return
                }
            }
            attempt = 0
            connect()
        }

        connect()
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', onAuthOrStorage)
            window.addEventListener('zhin:auth-required', onAuthOrStorage)
            // Remote Console may fire this after successful login (token written).
            window.addEventListener('zhin:auth-changed', onAuthOrStorage)
            window.addEventListener('zhin:api-base-changed', onAuthOrStorage)
        }
        return () => {
            closed = true
            if (retryTimer) clearTimeout(retryTimer)
            if (typeof window !== 'undefined') {
                window.removeEventListener('storage', onAuthOrStorage)
                window.removeEventListener('zhin:auth-required', onAuthOrStorage)
                window.removeEventListener('zhin:auth-changed', onAuthOrStorage)
                window.removeEventListener('zhin:api-base-changed', onAuthOrStorage)
            }
            wsRef.current?.close()
            wsRef.current = null
            setConnected(false)
        }
    }, [])

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
    useEffect(() => { setPreviewSegments(inputText.trim() ? parseTextToSegments(inputText) : []) }, [inputText])

    const loadTrace = useCallback(async (quiet = false) => {
        if (!quiet) setTraceLoading(true)
        try {
            const current = traceRef.current?.sessionKey === sessionKey ? traceRef.current : null
            let incoming = await fetchAgentTrace(sessionKey, quiet ? current?.latestSequence ?? 0 : 0)
            if (quiet && current?.runtimeId && incoming.runtimeId && current.runtimeId !== incoming.runtimeId) {
                incoming = await fetchAgentTrace(sessionKey, 0)
            }
            const merged = mergeTraceSnapshot(current, incoming)
            traceRef.current = merged
            setTrace(merged)
            saveCachedAgentTrace(merged)
            setTraceNotice(null)
        } catch (error) {
            setTraceNotice(error instanceof Error ? error.message : 'Agent Trace 暂不可用')
        } finally {
            if (!quiet) setTraceLoading(false)
        }
    }, [sessionKey])

    useEffect(() => {
        const cached = loadCachedAgentTrace(sessionKey)
        traceRef.current = cached
        setTrace(cached)
        setTraceNotice(null)
        void loadTrace()
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void loadTrace(true)
        }, 2_000)
        return () => window.clearInterval(timer)
    }, [loadTrace])

    const parseTextToSegments = (text: string): MessageSegment[] => {
        const segments: MessageSegment[] = []
        const regex = /\[@([^\]]+)\]|\[face:(\d+)\]|\[image:([^\]]+)\]|\[video:([^\]]+)\]|\[audio:([^\]]+)\]/g
        let lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                const t = text.substring(lastIndex, match.index)
                if (t) segments.push({ type: 'text', data: { text: t } })
            }
            if (match[1]) segments.push({ type: 'mention', data: { target: match[1], name: match[1] } })
            else if (match[2]) segments.push({ type: 'face', data: { id: parseInt(match[2], 10) } })
            else if (match[3]) segments.push({ type: 'image', data: { media: { kind: 'url', value: match[3] } } })
            else if (match[4]) segments.push({ type: 'video', data: { media: { kind: 'url', value: match[4] } } })
            else if (match[5]) segments.push({ type: 'audio', data: { media: { kind: 'url', value: match[5] } } })
            lastIndex = regex.lastIndex
        }
        if (lastIndex < text.length) {
            const r = text.substring(lastIndex)
            if (r) segments.push({ type: 'text', data: { text: r } })
        }
        return segments.length > 0 ? segments : [{ type: 'text', data: { text } }]
    }

    const hasRenderableSegments = (segments: MessageSegment[]) => {
        if (segments.length === 0) return false
        return segments.some((s) => {
            if (s.type === 'text') return Boolean(String(s.data?.text ?? '').trim())
            if (s.type === 'keyboard') return true
            return true
        })
    }

    const renderMessageSegments = (
        segments: (MessageSegment | string)[],
        isSent: boolean,
        messageId?: string,
        interactionResolved = false,
    ) => {
        const ring = isSent ? 'ring-1 ring-primary-foreground/25' : 'ring-1 ring-border/60'
        return segments.map((segment, index) => {
            if (typeof segment === 'string') {
                return <MarkdownContent key={index} text={segment} className={isSent ? 'zhin-markdown--inverse' : undefined} />
            }
            const d = segment.data as Record<string, unknown>
            switch (segment.type) {
                case 'text':
                case 'markdown':
                case 'md':
                    return <MarkdownContent key={index} text={String(d.text ?? d.content ?? '')} className={isSent ? 'zhin-markdown--inverse' : undefined} />
                case 'code':
                    return <CodeBlock key={index} code={String(d.code ?? d.text ?? d.content ?? '')} language={String(d.language ?? d.lang ?? '')} />
                case 'mention':
                case 'at':
                    return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-xs mx-0.5">@{String(d.name ?? d.target ?? d.qq ?? '')}</span>
                case 'face':
                    return <img key={index} src={`https://face.viki.moe/apng/${d.id}.png`} alt={String(d.name ?? '')} className="w-6 h-6 inline-block align-middle mx-0.5" title={String(d.name ?? d.id ?? '')} />
                case 'dice':
                    return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-xs mx-0.5">🎲 {d.result != null ? `点数 ${String(d.result)}` : '骰子'}</span>
                case 'rps':
                    return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-xs mx-0.5">✊ {d.result != null ? `结果 ${String(d.result)}` : '猜拳'}</span>
                case 'image': {
                    const raw = pickMediaRawUrl(d)
                    const src = resolveMediaSrc(raw, 'image')
                    if (!src) return <span key={index} className="text-xs opacity-70">[图片]</span>
                    return (
                        <a key={index} href={src} target="_blank" rel="noreferrer" className="block my-1">
                            <img src={src} alt="" className={cn('max-w-[min(320px,88vw)] rounded-lg block', ring, 'ring-offset-0')} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        </a>
                    )
                }
                case 'video': {
                    const raw = pickMediaRawUrl(d)
                    const src = resolveMediaSrc(raw, 'video')
                    if (!src) return <span key={index} className="text-xs opacity-70">[视频无地址]</span>
                    return (
                        <video
                            key={index}
                            src={src}
                            controls
                            playsInline
                            preload="metadata"
                            className={cn('max-w-[min(360px,92vw)] max-h-72 rounded-lg my-1 bg-black/10', ring)}
                        />
                    )
                }
                case 'audio':
                case 'record': {
                    const raw = pickMediaRawUrl(d)
                    const src = resolveMediaSrc(raw, 'audio')
                    if (!src) return <span key={index} className="text-xs opacity-70">[音频无地址]</span>
                    return (
                        <audio
                            key={index}
                            src={src}
                            controls
                            preload="metadata"
                            className={cn('w-full max-w-sm my-2 h-10', isSent && 'opacity-95')}
                        />
                    )
                }
                case 'reply':
                    return (
                        <div key={index} className="mb-1 rounded-md border border-dashed px-2 py-1 text-xs opacity-90">
                            ↩ 引用消息 #{String(d.message_id ?? d.id ?? '')}
                        </div>
                    )
                case 'forward': {
                    const messages = d.messages as Array<Array<{ type?: string; data?: Record<string, unknown> }>> | undefined
                    const title = String(d.title ?? '聊天记录')
                    return (
                        <div key={index} className="my-1 rounded-md border bg-background/40 px-2 py-2 text-xs space-y-1">
                            <div className="font-medium">📨 {title}</div>
                            {Array.isArray(messages) && messages.length > 0 ? (
                                <div className="space-y-1 pl-2 border-l-2 border-muted">
                                    {messages.slice(0, 3).map((batch, bi) => (
                                        <div key={bi} className="opacity-90">
                                            {batch.map((s, si) => (
                                                <span key={si}>
                                                    {s.type === 'text' ? String(s.data?.text ?? '') : `[${s.type ?? 'seg'}]`}
                                                </span>
                                            ))}
                                        </div>
                                    ))}
                                    {messages.length > 3 && <div className="opacity-60">…共 {messages.length} 条</div>}
                                </div>
                            ) : (
                                <div className="opacity-70">[合并转发]</div>
                            )}
                        </div>
                    )
                }
                case 'keyboard': {
                    const rows = (d.rows as Array<Array<{ label: string; payload: string; disabled?: boolean; style?: string }>>) ?? []
                    const resolved = Boolean(messageId && interactionResolved)
                    return (
                        <div key={index} className="agent-playground-approval-actions">
                            {rows.map((row, ri) => (
                                <div key={ri}>
                                    {row.map((btn) => (
                                        <button
                                            key={btn.payload}
                                            type="button"
                                            disabled={btn.disabled || isSent || resolved}
                                            onClick={() => sendInteractiveAction(btn.payload, messageId)}
                                            className={cn(
                                                (btn.style === 'primary' || /^允许/u.test(btn.label)) && 'is-primary',
                                                (btn.style === 'danger' || /拒绝|取消/u.test(btn.label)) && 'is-danger',
                                            )}
                                        >
                                            {btn.label}
                                        </button>
                                    ))}
                                </div>
                            ))}
                            {resolved && <small><Check size={12} />已提交本次选择</small>}
                        </div>
                    )
                }
                default:
                    return <span key={index} className="text-xs opacity-70">[{segment.type}]</span>
            }
        })
    }

    const handleSendMessage = (text: string, segments: MessageSegment[]) => {
        if (!canExecute || !hasRenderableSegments(segments)) return
        const newMessage: Message = { id: `msg_${Date.now()}`, type: 'sent', channelType: activeChannel.type, channelId: activeChannel.id, channelName: activeChannel.name, senderId: 'test_user', senderName: '测试用户', content: segments, timestamp: Date.now() }
        setMessages((prev) => [...prev, newMessage]); setInputText(''); setPreviewSegments([]); setComposerMode('write')
        editorRef.current?.clear()
        // Stamp type+id so Host sandbox endpoint preserves channel context for outbound replies.
        const payload = JSON.stringify({
            type: activeChannel.type,
            id: activeChannel.id,
            messageId: newMessage.id,
            content: segments,
            agentRun: activeChannel.runConfig,
            timestamp: Date.now(),
        })
        wsRef.current?.send(payload)
    }


    const clearMessages = () => {
        setMessages((current) => current.filter((message) => !(
            message.channelId === activeChannel.id && message.channelType === activeChannel.type
        )))
        setConfirmClear(false)
    }
    const switchChannel = (channel: Channel) => { setActiveChannel(channel); setChannels((prev) => prev.map((c) => c.id === channel.id && c.type === channel.type ? { ...c, unread: 0 } : c)); if (window.innerWidth < 900) setShowChannelList(false) }
    const updateRunConfig = (patch: Partial<SandboxAgentRunConfig>) => {
        const next = { ...activeChannel, runConfig: { ...activeChannel.runConfig, ...patch } }
        setActiveChannel(next)
        setChannels((sessions) => sessions.map((session) => session.id === activeChannel.id && session.type === activeChannel.type ? next : session))
    }
    const addSession = () => {
        const label = newSessionName.trim() || '未命名试验'
        const id = `${newSessionScope}-${Date.now().toString(36)}`
        const session: Channel = {
            id, name: label, type: newSessionScope, unread: 0,
            runConfig: { ...activeChannel.runConfig },
        }
        setChannels((current) => [...current, session])
        setActiveChannel(session)
        setNewSessionName('')
        setShowNewSession(false)
    }
    const getChannelIcon = (type: string) => { switch (type) { case 'private': return <User size={16} />; case 'group': return <Users size={16} />; case 'channel': return <Hash size={16} />; default: return <MessageSquare size={16} /> } }
    const insertFace = (faceId: number) => { editorRef.current?.insertFace(faceId); setShowFacePicker(false) }
    const commitMediaUrl = () => {
        const u = mediaUrl.trim()
        if (!u || !mediaPanel) return
        if (mediaPanel === 'image') editorRef.current?.insertImage(u)
        else if (mediaPanel === 'video') editorRef.current?.insertVideo(u)
        else editorRef.current?.insertAudio(u)
        setMediaUrl('')
        setMediaPanel(null)
    }
    const selectAtUser = (user: { id: string; name: string }) => { editorRef.current?.replaceAtTrigger(user.name, user.id); setAtPopoverPosition(null); setAtSearchQuery('') }
    const handleAtTrigger = (show: boolean, searchQuery: string, position?: { top: number; left: number }) => {
        if (activeChannel.type === 'private') { setAtPopoverPosition(null); setAtSearchQuery(''); return }
        if (show && position) { setAtPopoverPosition(position); setAtSearchQuery(searchQuery) } else { setAtPopoverPosition(null); setAtSearchQuery('') }
    }
    const filteredAtSuggestions = atSuggestions.filter((user) => { if (!atSearchQuery.trim()) return true; const q = atSearchQuery.toLowerCase(); return user.name.toLowerCase().includes(q) || user.id.toLowerCase().includes(q) })
    const handleEditorChange = (text: string, segments: MessageSegment[]) => { setInputText(text); setPreviewSegments(segments) }
    const filteredFaces = faceList.filter(face => face.name.toLowerCase().includes(faceSearchQuery.toLowerCase()) || face.describe.toLowerCase().includes(faceSearchQuery.toLowerCase()))
    const channelMessages = messages.filter((msg) => msg.channelId === activeChannel.id && msg.channelType === activeChannel.type)
    const lastUserMessage = [...channelMessages].reverse().find((message) => message.type === 'sent')
    const currentTaskMessage = currentTask?.sourceMessageId
        ? channelMessages.find((message) => message.id === currentTask.sourceMessageId && message.type === 'sent')
        : undefined
    const scopeLabel = activeChannel.type === 'private' ? '单用户' : activeChannel.type === 'group' ? '群组上下文' : '频道上下文'
    const runPrompt = (prompt: string) => handleSendMessage(prompt, [{ type: 'text', data: { text: prompt } }])
    const recentTraceEvents = trace?.events.slice(-8).reverse() ?? []
    const stopActiveTask = async () => {
        setStoppingTask(true)
        try {
            const cancelled = await cancelAgentTask(sessionKey)
            setTraceNotice(cancelled ? '已发送停止请求，正在等待任务结束。' : '当前会话没有运行中的任务。')
            window.setTimeout(() => void loadTrace(true), 240)
        } catch (error) {
            setTraceNotice(error instanceof Error ? error.message : '无法停止任务')
            setShowInspector(true)
        } finally {
            setStoppingTask(false)
        }
    }
    const retryLastTask = () => {
        if (!lastUserMessage) return
        handleSendMessage(messageText(lastUserMessage.content), [...lastUserMessage.content])
    }
    const retryCurrentTask = () => {
        if (!currentTaskMessage) return
        handleSendMessage(messageText(currentTaskMessage.content), [...currentTaskMessage.content])
    }
    const exportCurrentRun = () => {
        if (!trace || !currentTask) return
        const report = buildAgentRunReport(trace, {
            run: currentTask,
            sessionName: activeChannel.name,
            taskPrompt: currentTaskMessage ? messageText(currentTaskMessage.content) : undefined,
            workingDirectory: activeChannel.runConfig.workingDirectory,
            safetyMode: activeChannel.runConfig.safetyMode,
            approvalMode: activeChannel.runConfig.approvalMode,
            networkAccess: activeChannel.runConfig.safetyMode === 'danger-full-access' || activeChannel.runConfig.networkAccess,
        })
        const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `zhin-agent-run-${safeFileName(activeChannel.name)}-${currentTask.turnId.slice(0, 8)}.md`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    const inlineRunCard = currentTask ? (
        <article className={cn('agent-playground-inline-run', `is-${currentTask.status}`)} aria-live={currentTask.status === 'running' ? 'polite' : undefined}>
            <span className="agent-playground-inline-run-rail" aria-hidden="true" />
            <div className="agent-playground-inline-run-head">
                <span className="agent-playground-inline-run-icon"><ListChecks size={17} /></span>
                <div className="agent-playground-inline-run-copy">
                    <span>{currentTask.status === 'running' ? 'Live agent run' : 'Agent run summary'}</span>
                    <h3>{taskStatusLabel(currentTask.status)}</h3>
                    {currentTaskMessage && <p>{messageText(currentTaskMessage.content)}</p>}
                </div>
                <div className="agent-playground-inline-run-actions">
                    {currentTask.status === 'running' ? (
                        <button type="button" className="is-stop" onClick={() => void stopActiveTask()} disabled={stoppingTask}><Square size={12} />{stoppingTask ? '停止中' : '停止'}</button>
                    ) : currentTaskMessage ? (
                        <button type="button" onClick={retryCurrentTask}><RotateCcw size={13} />重试</button>
                    ) : null}
                    <button type="button" onClick={exportCurrentRun} title="导出 Markdown 运行报告"><FileDown size={13} />导出</button>
                </div>
            </div>
            <dl className="agent-playground-inline-run-metrics">
                <div><dt>耗时</dt><dd>{currentTask.durationMs === undefined ? '进行中' : formatDuration(currentTask.durationMs)}</dd></div>
                <div><dt>步骤</dt><dd>{currentRunSteps.length}</dd></div>
                <div><dt>工具</dt><dd>{currentTask.toolCount}</dd></div>
                <div><dt>Token</dt><dd>{currentTask.tokenCount.toLocaleString()}</dd></div>
                <div className={cn(currentTask.problemCount > 0 && 'has-problem')}><dt>异常</dt><dd>{currentTask.problemCount}</dd></div>
            </dl>
            {inlineRunExpanded && (
                currentRunSteps.length > 0 ? (
                    <ol className="agent-playground-inline-run-steps">
                        {currentRunSteps.map((step) => (
                            <li key={step.id} className={cn(`is-${step.status}`)}>
                                <i aria-hidden="true" />
                                <div><strong>{step.title}</strong>{step.detail && <small>{step.detail}</small>}</div>
                                <span>{step.durationMs === undefined ? runStepStatusLabel(step.status) : formatDuration(step.durationMs)}</span>
                            </li>
                        ))}
                    </ol>
                ) : <div className="agent-playground-inline-run-empty">正在等待第一条运行事件…</div>
            )}
            <footer>
                <button type="button" aria-expanded={inlineRunExpanded} onClick={() => setInlineRunExpanded((expanded) => !expanded)}>
                    <ChevronDown size={13} />{inlineRunExpanded ? '收起步骤' : `查看 ${currentRunSteps.length} 个步骤`}
                </button>
                <button type="button" onClick={() => { setInspectorView(currentRunArtifacts.length > 0 ? 'artifacts' : 'runs'); setShowInspector(true) }}>
                    {currentRunArtifacts.length > 0 ? `${currentRunArtifacts.length} 个变更与产物` : '打开运行检查器'}<PanelRight size={13} />
                </button>
            </footer>
        </article>
    ) : null

    return (
        <section className="agent-playground-shell">
            <div className="agent-playground-mobilebar">
                <button type="button" aria-expanded={showChannelList} onClick={() => setShowChannelList(!showChannelList)}><MessageSquare size={17} />测试会话</button>
                <strong>Agent 试验台</strong>
                <button type="button" aria-expanded={showInspector} onClick={() => setShowInspector(!showInspector)}><PanelRight size={17} />检查器</button>
            </div>

            <nav className={cn("channel-sidebar agent-playground-sessions", showChannelList && "show")} aria-label="测试会话">
                <div className="agent-playground-brand">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="agent-playground-mark"><Sparkles size={16} /></span>
                            <div><h2>Agent 试验台</h2><small>Sandbox playground</small></div>
                        </div>
                        <span className={cn("agent-playground-connection", connected && "is-online")} title={connected ? 'Sandbox WebSocket 已连接' : '正在重连 Sandbox WebSocket'}>
                            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                        </span>
                    </div>
                </div>

                <div className="agent-playground-section-label"><span>测试会话</span><span>{channels.length}</span></div>
                <div className="agent-playground-session-list">
                    {channels.map((channel) => {
                        const isActive = activeChannel.id === channel.id && activeChannel.type === channel.type
                        return (
                            <button type="button" key={`${channel.type}:${channel.id}`} aria-current={isActive ? 'page' : undefined} className={cn("agent-playground-session", isActive && "active")} onClick={() => switchChannel(channel)}>
                                <span className="agent-playground-session-icon">{getChannelIcon(channel.type)}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{channel.name}</div>
                                    <div className="text-xs text-muted-foreground">{channel.type === 'private' ? '单用户作用域' : channel.type === 'group' ? '群组作用域' : '频道作用域'}</div>
                                </div>
                                {channel.unread > 0 && <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1">{channel.unread}</span>}
                            </button>
                        )
                    })}
                </div>

                <div className="agent-playground-new-session">
                    {showNewSession ? (
                        <div className="agent-playground-new-form">
                            <input value={newSessionName} onChange={(event) => setNewSessionName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addSession() }} placeholder="会话名称" autoFocus />
                            <div className="agent-playground-scope-picker" role="group" aria-label="消息作用域">
                                {(['private', 'group', 'channel'] as SandboxScope[]).map((scope) => (
                                    <button type="button" key={scope} aria-pressed={newSessionScope === scope} className={cn(newSessionScope === scope && 'active')} onClick={() => setNewSessionScope(scope)}>
                                        {scope === 'private' ? '单用户' : scope === 'group' ? '群组' : '频道'}
                                    </button>
                                ))}
                            </div>
                            <div className="agent-playground-new-actions">
                                <button type="button" onClick={() => setShowNewSession(false)}>取消</button>
                                <button type="button" className="primary" onClick={addSession}>创建</button>
                            </div>
                        </div>
                    ) : (
                        <button type="button" className="agent-playground-add" onClick={() => setShowNewSession(true)}><Plus size={15} />新建测试会话</button>
                    )}
                </div>
                <div className="agent-playground-endpoint">
                    <span>{persistenceStatus === 'saved' ? '会话已持久化' : '会话保存失败'}</span>
                    <strong>{endpointId}</strong>
                </div>
            </nav>

            {showChannelList && <div className="channel-overlay" onClick={() => setShowChannelList(false)} />}

            <main className="chat-area agent-playground-main">
                <header className="agent-playground-runbar">
                    <div className="agent-playground-run-identity">
                        <span className="agent-playground-run-icon">{getChannelIcon(activeChannel.type)}</span>
                        <div>
                            <div className="agent-playground-run-title"><h1>{activeChannel.name}</h1><span>{scopeLabel}</span></div>
                            <code>{sessionKey}</code>
                        </div>
                    </div>
                    <div className="agent-playground-run-actions">
                        <span className={cn("agent-playground-run-state", currentTask?.status === 'running' && "is-running", currentTask?.status === 'failed' && 'has-problem')}>
                            {currentTask?.status === 'running' ? <Activity size={14} /> : <Gauge size={14} />}
                            {currentTask ? taskStatusLabel(currentTask.status) : `${channelMessages.length} 条消息`}
                        </span>
                        {currentTask?.status === 'running' ? (
                            <button type="button" className="agent-playground-stop" onClick={() => void stopActiveTask()} disabled={stoppingTask} aria-label="停止当前任务"><Square size={13} />{stoppingTask ? '停止中' : '停止'}</button>
                        ) : lastUserMessage ? (
                            <button type="button" onClick={retryLastTask} aria-label="重新运行上一个任务"><RotateCcw size={14} />重试</button>
                        ) : null}
                        <a href={agentStudioPath(sessionKey)}><ExternalLink size={14} />Agent Studio</a>
                        <button type="button" className={cn(showRunSettings && 'active')} aria-expanded={showRunSettings} onClick={() => setShowRunSettings((visible) => !visible)} aria-label="配置运行环境"><SlidersHorizontal size={16} /></button>
                        <button type="button" aria-expanded={showInspector} onClick={() => setShowInspector(!showInspector)} aria-label="切换运行检查器"><PanelRight size={16} /></button>
                        <button type="button" onClick={() => setConfirmClear(true)} aria-label="清空当前会话"><Trash2 size={15} /></button>
                    </div>
                </header>

                {confirmClear && (
                    <div className="agent-playground-confirm" role="alert">
                        <div><strong>清空当前测试记录？</strong><span>只移除“{activeChannel.name}”在浏览器中的消息，不影响 Agent 会话存储。</span></div>
                        <button type="button" onClick={() => setConfirmClear(false)}>取消</button>
                        <button type="button" className="danger" onClick={clearMessages}>确认清空</button>
                    </div>
                )}

                {transportNotice && (
                    <div className="agent-playground-confirm" role="status">
                        <div><strong>运行暂不可用</strong><span>{transportNotice}</span></div>
                        <button type="button" onClick={() => setTransportNotice(null)}>知道了</button>
                    </div>
                )}

                {showRunSettings && (
                    <section className="agent-playground-run-settings" aria-label="运行配置">
                        <label className="agent-playground-directory-field">
                            <span><FolderOpen size={14} />工作目录</span>
                            <input
                                value={activeChannel.runConfig.workingDirectory}
                                onChange={(event) => updateRunConfig({ workingDirectory: event.target.value })}
                                placeholder="使用 Host 项目目录"
                                spellCheck={false}
                            />
                        </label>
                        <label>
                            <span><ShieldCheck size={14} />安全策略</span>
                            <select value={activeChannel.runConfig.safetyMode} onChange={(event) => {
                                const safetyMode = event.target.value as SandboxAgentRunConfig['safetyMode']
                                updateRunConfig({ safetyMode, ...(safetyMode === 'danger-full-access' ? { networkAccess: true } : {}) })
                            }}>
                                <option value="read-only">只读</option>
                                <option value="workspace-write">工作区写入</option>
                                <option value="danger-full-access">完全访问</option>
                            </select>
                        </label>
                        <label>
                            <span>审批策略</span>
                            <select
                                value={activeChannel.runConfig.safetyMode === 'read-only' ? 'deny' : activeChannel.runConfig.safetyMode === 'danger-full-access' ? 'allow' : activeChannel.runConfig.approvalMode}
                                disabled={activeChannel.runConfig.safetyMode !== 'workspace-write'}
                                onChange={(event) => updateRunConfig({ approvalMode: event.target.value as SandboxAgentRunConfig['approvalMode'] })}
                            >
                                <option value="ask">按需确认</option>
                                <option value="deny">自动拒绝</option>
                                <option value="allow">自动允许</option>
                            </select>
                        </label>
                        <label className="agent-playground-network-toggle">
                            <span><Network size={14} />网络访问</span>
                            <input
                                type="checkbox"
                                checked={activeChannel.runConfig.safetyMode === 'danger-full-access' || activeChannel.runConfig.networkAccess}
                                disabled={activeChannel.runConfig.safetyMode === 'danger-full-access'}
                                onChange={(event) => updateRunConfig({ networkAccess: event.target.checked })}
                            />
                            <i aria-hidden="true" />
                        </label>
                        {activeChannel.runConfig.safetyMode === 'danger-full-access' && (
                            <p><CircleAlert size={14} />完全访问允许 Agent 操作工作目录之外的文件并访问网络，请仅用于可信任务。</p>
                        )}
                        {activeChannel.runConfig.safetyMode !== 'danger-full-access' && shellIsolation?.available === false && (
                            <p><CircleAlert size={14} />安全 Shell 需要可用的 Docker daemon；当前仅文件工具可运行。{shellIsolation.message}</p>
                        )}
                    </section>
                )}

                {/* Messages */}
                <section className="agent-playground-conversation" aria-label="Agent 对话">
                    <div className="agent-playground-message-scroll">
                        {channelMessages.length === 0 ? (
                            <div className="agent-playground-empty">
                                <span className="agent-playground-empty-mark"><Sparkles size={24} /></span>
                                <div><h2>开始一次可观察的 Agent 运行</h2><p>发送任务后，回复、工具调用、Token 与异常会在同一会话上下文中关联。</p></div>
                                <div className="agent-playground-prompts">
                                    <button type="button" onClick={() => runPrompt('介绍当前 Agent 可以使用的能力，并给出三个具体示例。')}>探索可用能力</button>
                                    <button type="button" onClick={() => runPrompt('用 Markdown 表格总结当前运行环境，并附上一段 TypeScript 示例代码。')}>测试富文本输出</button>
                                    <button type="button" onClick={() => runPrompt('分析一个任务从推理、工具调用到最终回复的完整执行路径。')}>观察执行路径</button>
                                </div>
                            </div>
                        ) : (
                            <div className="agent-playground-message-list">
                                {channelMessages.map((msg) => {
                                    const isApproval = msg.type === 'received' && msg.content.some((segment) => segment.type === 'keyboard')
                                    return (
                                    <React.Fragment key={msg.id}>
                                    <article className={cn("agent-playground-message", msg.type === 'sent' ? "is-user" : "is-agent", isApproval && "is-approval")}>
                                        <span className="agent-playground-message-avatar">{msg.type === 'received' ? <Bot size={16} /> : <User size={16} />}</span>
                                        <div className="agent-playground-message-main">
                                            <div className="agent-playground-message-meta">
                                                <strong>{isApproval ? '需要你的确认' : msg.type === 'received' ? endpointId : '你'}</strong>
                                                {isApproval && <span>approval required</span>}
                                                <time>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                                            </div>
                                            <div className="agent-playground-message-content">{renderMessageSegments(msg.content, msg.type === 'sent', msg.id, msg.interactionResolved === true)}</div>
                                        </div>
                                    </article>
                                    {currentTaskMessage?.id === msg.id && inlineRunCard}
                                    </React.Fragment>
                                    )
                                })}
                                {!currentTaskMessage && inlineRunCard}
                                <div ref={messagesEndRef} />
                            </div>
                        )}
                    </div>
                </section>

                {/* Input area */}
                <section className="agent-playground-composer" aria-label="任务输入">
                    {/* Toolbar */}
                    <div className="flex gap-2 items-center flex-wrap">
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", showFacePicker ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setShowFacePicker(!showFacePicker); setMediaPanel(null) }} title="插入表情">
                            <Smile size={16} />
                        </button>
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === 'image' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setMediaPanel((p) => (p === 'image' ? null : 'image')); setShowFacePicker(false) }} title="插入图片 URL">
                            <Image size={16} />
                        </button>
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === 'video' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setMediaPanel((p) => (p === 'video' ? null : 'video')); setShowFacePicker(false) }} title="插入视频 URL">
                            <Video size={16} />
                        </button>
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === 'audio' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setMediaPanel((p) => (p === 'audio' ? null : 'audio')); setShowFacePicker(false) }} title="插入音频 URL">
                            <Music size={16} />
                        </button>
                        <div className="flex-1 min-w-[1rem]" />
                        <div className="sandbox-composer-tabs" role="tablist" aria-label="消息编辑模式">
                            <button type="button" role="tab" aria-selected={composerMode === 'write'} className={cn(composerMode === 'write' && 'active')} onClick={() => setComposerMode('write')}>编写</button>
                            <button type="button" role="tab" aria-selected={composerMode === 'preview'} className={cn(composerMode === 'preview' && 'active')} onClick={() => setComposerMode('preview')}>预览</button>
                        </div>
                        {inputText && (
                            <button className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-accent transition-colors"
                                onClick={() => { editorRef.current?.clear(); setInputText(''); setPreviewSegments([]); setComposerMode('write') }} aria-label="清空输入"><X size={16} /></button>
                        )}
                    </div>

                    {/* Face picker */}
                    {showFacePicker && (
                        <div className="p-3 rounded-md border bg-muted/30 max-h-64 overflow-y-auto space-y-2">
                            <input value={faceSearchQuery} onChange={(e) => setFaceSearchQuery(e.target.value)}
                                placeholder="搜索表情..." className="w-full h-8 rounded-md border bg-transparent px-2 text-sm" />
                            <div className="grid grid-cols-8 gap-1">
                                {filteredFaces.slice(0, 80).map((face) => (
                                    <button key={face.id} onClick={() => insertFace(face.id)} title={face.name}
                                        className="w-10 h-10 rounded-md border flex items-center justify-center hover:bg-accent transition-colors">
                                        <img src={`https://face.viki.moe/apng/${face.id}.png`} alt={face.name} className="w-8 h-8" />
                                    </button>
                                ))}
                            </div>
                            {filteredFaces.length === 0 && (
                                <div className="flex flex-col items-center gap-2 py-4">
                                    <Search size={32} className="text-muted-foreground/30" />
                                    <span className="text-sm text-muted-foreground">未找到匹配的表情</span>
                                </div>
                            )}
                        </div>
                    )}

                    {mediaPanel && (
                        <div className="p-3 rounded-md border bg-muted/30 space-y-2">
                            <p className="text-xs text-muted-foreground">
                                {mediaPanel === 'image' && '支持 http(s) 图片链接或 data URL'}
                                {mediaPanel === 'video' && '支持浏览器可解码的视频直链（如 .mp4、.webm）'}
                                {mediaPanel === 'audio' && '支持 .mp3、.ogg、.wav 等音频直链'}
                            </p>
                            <input
                                value={mediaUrl}
                                onChange={(e) => setMediaUrl(e.target.value)}
                                placeholder={mediaPanel === 'image' ? '图片 URL…' : mediaPanel === 'video' ? '视频 URL…' : '音频 URL…'}
                                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitMediaUrl() } }}
                            />
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                                onClick={commitMediaUrl}
                                disabled={!mediaUrl.trim()}
                            >
                                <Check size={14} /> 插入到输入框
                            </button>
                        </div>
                    )}

                    {/* Editor + send */}
                    <div className="flex gap-2 items-start">
                        <div className="flex-1 relative">
                            <div className={composerMode === 'write' ? 'block' : 'hidden'}>
                                <RichTextEditor
                                    ref={editorRef} placeholder={`向 ${activeChannel.name} 发送消息，支持 Markdown...`}
                                    onSend={handleSendMessage} onChange={handleEditorChange} onAtTrigger={handleAtTrigger}
                                    minHeight="44px" maxHeight="200px"
                                />
                            </div>
                            {composerMode === 'preview' && (
                                <div className="sandbox-markdown-preview" role="tabpanel">
                                    {inputText.trim()
                                        ? <MarkdownContent text={inputText} />
                                        : <span className="sandbox-markdown-preview-empty">输入 Markdown 后可在这里检查最终效果</span>}
                                </div>
                            )}
                            {atPopoverPosition && (
                                <div className="absolute z-50 rounded-lg border bg-popover shadow-md min-w-60 max-h-72 overflow-y-auto p-1"
                                    style={{ top: `${atPopoverPosition.top}px`, left: `${atPopoverPosition.left}px` }}>
                                    {filteredAtSuggestions.length > 0 ? filteredAtSuggestions.map((user) => (
                                        <div key={user.id} className="flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-accent transition-colors" onClick={() => selectAtUser(user)}>
                                            <User size={16} className="text-muted-foreground" />
                                            <div className="flex-1"><div className="text-sm font-medium">{user.name}</div><div className="text-xs text-muted-foreground">ID: {user.id}</div></div>
                                        </div>
                                    )) : (
                                        <div className="flex flex-col items-center gap-2 p-4">
                                            <Search size={20} className="text-muted-foreground/50" />
                                            <span className="text-xs text-muted-foreground">未找到匹配的用户</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <button
                            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-colors hover:bg-primary/90"
                            onClick={() => { const c = editorRef.current?.getContent(); if (c) handleSendMessage(c.text, c.segments) }}
                            disabled={!canExecute || !hasRenderableSegments(previewSegments)}>
                            <Send size={16} /> 发送
                        </button>
                    </div>

                    {/* Hints */}
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <Info size={12} /> 快捷操作:
                        <span className="px-1 py-0.5 rounded border text-[10px]">Enter</span> 发送
                        <span className="px-1 py-0.5 rounded border text-[10px]">Shift+Enter</span> 换行
                        <span className="px-1 py-0.5 rounded border text-[10px]">```ts</span> 代码块
                        <span className="px-1 py-0.5 rounded border text-[10px]">**文本**</span> 加粗
                        <span className="px-1 py-0.5 rounded border text-[10px]">[@名称]</span> @某人
                        <span className="px-1 py-0.5 rounded border text-[10px]">[video:URL]</span>
                        <span className="px-1 py-0.5 rounded border text-[10px]">[audio:URL]</span>
                    </div>
                </section>
            </main>

            <aside className={cn("agent-playground-inspector", showInspector && "show")} aria-label="运行检查器">
                <div className="agent-playground-inspector-head">
                    <div><span>Run inspector</span><h2>运行检查器</h2></div>
                    <div>
                        <button type="button" onClick={() => void loadTrace()} aria-label="刷新 Agent Trace" disabled={traceLoading}><RefreshCw size={15} className={cn(traceLoading && 'animate-spin')} /></button>
                        <button type="button" className="agent-playground-inspector-close" onClick={() => setShowInspector(false)} aria-label="关闭运行检查器"><X size={15} /></button>
                    </div>
                </div>

                <div className="agent-playground-inspector-tabs" role="tablist" aria-label="检查器视图">
                    <button type="button" role="tab" aria-selected={inspectorView === 'runs'} className={cn(inspectorView === 'runs' && 'active')} onClick={() => setInspectorView('runs')}><Activity size={13} />任务</button>
                    <button type="button" role="tab" aria-selected={inspectorView === 'artifacts'} className={cn(inspectorView === 'artifacts' && 'active')} onClick={() => setInspectorView('artifacts')}><FileDiff size={13} />变更与产物 <span>{workbenchArtifacts.length}</span></button>
                </div>

                <div className={cn("agent-playground-inspector-view", inspectorView !== 'runs' && 'hidden')}>

                <section className="agent-playground-inspector-section">
                    <div className="agent-playground-inspector-title"><span>运行概览</span><small>{traceSummary.activeTurns > 0 ? 'live' : 'idle'}</small></div>
                    <div className="agent-playground-metrics">
                        <div><Activity /><strong>{traceSummary.eventCount.toLocaleString()}</strong><span>事件</span></div>
                        <div><Wrench /><strong>{traceSummary.toolCount.toLocaleString()}</strong><span>工具</span></div>
                        <div><Coins /><strong>{traceSummary.tokenCount.toLocaleString()}</strong><span>Token</span></div>
                        <div className={cn(traceSummary.problemCount > 0 && 'has-problem')}><CircleAlert /><strong>{traceSummary.problemCount}</strong><span>异常</span></div>
                    </div>
                </section>

                <section className="agent-playground-inspector-section">
                    <div className="agent-playground-inspector-title"><span>上下文</span></div>
                    <dl className="agent-playground-context-list">
                        <div><dt>Endpoint</dt><dd>{endpointId}</dd></div>
                        <div><dt>Scope</dt><dd>{activeChannel.type}</dd></div>
                        <div><dt>Scene</dt><dd>{activeChannel.id}</dd></div>
                        <div><dt>Workdir</dt><dd title={activeChannel.runConfig.workingDirectory}>{activeChannel.runConfig.workingDirectory || 'Host project root'}</dd></div>
                        <div><dt>Security</dt><dd>{activeChannel.runConfig.safetyMode}</dd></div>
                        <div><dt>Approval</dt><dd>{activeChannel.runConfig.safetyMode === 'read-only' ? 'deny' : activeChannel.runConfig.safetyMode === 'danger-full-access' ? 'allow' : activeChannel.runConfig.approvalMode}</dd></div>
                        <div><dt>Network</dt><dd>{activeChannel.runConfig.networkAccess ? 'enabled' : 'disabled'}</dd></div>
                        <div><dt>Isolation</dt><dd className={cn(shellIsolation?.available && 'is-online')}>{shellIsolation ? `${shellIsolation.provider}: ${shellIsolation.available ? 'ready' : 'unavailable'}` : 'checking'}</dd></div>
                        <div><dt>Transport</dt><dd className={cn(connected && 'is-online')}>{connected ? 'WebSocket online' : 'reconnecting'}</dd></div>
                    </dl>
                </section>

                <section className="agent-playground-inspector-section agent-playground-task-section">
                    <div className="agent-playground-inspector-title"><span>任务历史</span><small>{taskRuns.length} runs</small></div>
                    {taskRuns.length > 0 ? (
                        <div className="agent-playground-task-list">
                            {taskRuns.slice(0, 8).map((run) => (
                                <article key={run.id} className={cn(`is-${run.status}`)}>
                                    <i />
                                    <div><strong>{taskStatusLabel(run.status)}</strong><code>{run.turnId.slice(0, 10)}</code></div>
                                    <dl>
                                        <div><dt>耗时</dt><dd>{run.durationMs === undefined ? '进行中' : `${run.durationMs.toLocaleString()} ms`}</dd></div>
                                        <div><dt>工具</dt><dd>{run.toolCount}</dd></div>
                                        <div><dt>Token</dt><dd>{run.tokenCount.toLocaleString()}</dd></div>
                                    </dl>
                                </article>
                            ))}
                        </div>
                    ) : <div className="agent-playground-artifact-empty"><Activity size={18} /><span>运行任务后会在这里形成可回溯记录</span></div>}
                </section>

                <section className="agent-playground-inspector-section agent-playground-trace-section">
                    <div className="agent-playground-inspector-title"><span>最近执行</span><small>2s sync</small></div>
                    {traceLoading && !trace ? (
                        <div className="agent-playground-trace-loading"><i /><i /><i /></div>
                    ) : traceNotice && !trace?.events.length ? (
                        <div className="agent-playground-trace-notice"><CircleAlert size={16} /><span>{traceNotice}</span></div>
                    ) : recentTraceEvents.length ? (
                        <div className="agent-playground-trace-list">
                            {recentTraceEvents.map((event) => {
                                const item = presentTraceEvent(event)
                                return (
                                    <div key={event.sequence} className={cn("agent-playground-trace-item", `is-${item.tone}`)}>
                                        <span className="agent-playground-trace-dot" />
                                        <div><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</div>
                                        <time>{new Date(event.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="agent-playground-trace-empty"><Activity size={18} /><span>发送任务后显示推理与工具轨迹</span></div>
                    )}
                </section>
                </div>

                <div className={cn("agent-playground-inspector-view", inspectorView !== 'artifacts' && 'hidden')}>
                    <section className="agent-playground-inspector-section agent-playground-artifact-section">
                        <div className="agent-playground-inspector-title"><span>文件与命令产物</span><small>{workbenchArtifacts.length} items</small></div>
                        {workbenchArtifacts.length > 0 ? (
                            <div className="agent-playground-artifact-list">
                                {workbenchArtifacts.map((artifact) => {
                                    const ArtifactIcon = artifact.kind === 'file-change' ? FileDiff : artifact.kind === 'test' ? FlaskConical : Terminal
                                    const expanded = expandedArtifact === artifact.id
                                    return (
                                        <article key={artifact.id} className={cn(`is-${artifact.status}`, expanded && 'is-expanded')}>
                                            <button type="button" onClick={() => setExpandedArtifact(expanded ? null : artifact.id)} aria-expanded={expanded}>
                                                <span className="agent-playground-artifact-icon"><ArtifactIcon size={14} /></span>
                                                <span><strong>{artifact.title}</strong><small>{artifact.path ?? artifact.detail ?? artifact.kind}</small></span>
                                                <em>{artifact.status}</em>
                                                <ChevronDown size={14} />
                                            </button>
                                            {expanded && (
                                                <div className="agent-playground-artifact-detail">
                                                    {artifact.path && <code>{artifact.path}</code>}
                                                    {artifact.diff ? <pre>{artifact.diff}</pre> : <pre>{artifact.detail || '暂无输出'}</pre>}
                                                    <footer><span>{artifact.durationMs === undefined ? '等待结果' : `${artifact.durationMs.toLocaleString()} ms`}</span><code>{artifact.turnId.slice(0, 12)}</code></footer>
                                                </div>
                                            )}
                                        </article>
                                    )
                                })}
                            </div>
                        ) : <div className="agent-playground-artifact-empty"><FileDiff size={18} /><span>Agent 修改文件、执行命令或测试后，产物会集中出现在这里</span></div>}
                    </section>
                </div>

                <a className="agent-playground-studio-link" href={agentStudioPath(sessionKey)}><span><ExternalLink size={15} />在 Agent Studio 中完整诊断</span><code>{sessionKey}</code></a>
            </aside>
            {showInspector && <div className="agent-playground-inspector-overlay" onClick={() => setShowInspector(false)} />}
        </section>
    )
}

function taskStatusLabel(status: 'running' | 'completed' | 'failed' | 'cancelled'): string {
    if (status === 'running') return 'Agent 运行中'
    if (status === 'completed') return '最近任务已完成'
    if (status === 'failed') return '最近任务失败'
    return '最近任务已取消'
}

function messageText(segments: readonly MessageSegment[]): string {
    return segments.map((segment) => {
        const data = segment.data as Record<string, unknown>
        if (segment.type === 'text' || segment.type === 'markdown' || segment.type === 'md') {
            return String(data.text ?? data.content ?? '')
        }
        if (segment.type === 'mention' || segment.type === 'at') return `@${String(data.name ?? data.target ?? '')}`
        return `[${segment.type}]`
    }).join(' ').trim()
}

function formatDuration(durationMs: number): string {
    if (durationMs < 1_000) return `${durationMs.toLocaleString()} ms`
    if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`
    return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`
}

function runStepStatusLabel(status: 'running' | 'completed' | 'failed' | 'denied' | 'cancelled'): string {
    if (status === 'running') return '进行中'
    if (status === 'completed') return '完成'
    if (status === 'denied') return '已拒绝'
    if (status === 'cancelled') return '已取消'
    return '失败'
}

function safeFileName(value: string): string {
    return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48) || 'session'
}
