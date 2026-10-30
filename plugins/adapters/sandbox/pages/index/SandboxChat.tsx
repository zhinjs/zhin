import { sandboxText, type SandboxLocale } from './messages.js';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  cn,
  CodeBlock,
  MarkdownContent,
  resolveMediaSrc,
  pickMediaRawUrl,
  type MessageSegment,
} from '@zhin.js/client';
import { buildSandboxWebSocketUrl, captureSandboxRequestContext, createSandboxMessageId, submitSandboxFrame, SANDBOX_SCOPED_PROTOCOL, type SandboxRequestContext } from './sandboxTransport';
import { createWorkspaceDirectoryController, type DirectoryStatus } from './workspaceDirectoryState.js';
import type { SandboxWorkspaceScope } from './workspaceDirectory.js';
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
import HtmlMessage from './HtmlMessage.js';
import ConversationRecoveryPanel from './ConversationRecoveryPanel.js';
import { useSandboxHistory } from './useSandboxHistory.js';
import {
  agentSessionsPath,
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
  mergePlaygroundMessage,
  retirePlaygroundInteractions,
  type PlaygroundMessage,
  type PlaygroundSession,
} from './playgroundState.js';
import type { SandboxAgentRunConfig } from '../../src/run-config.js';

type Message = PlaygroundMessage
type Channel = PlaygroundSession
interface Face { id: number; emojiId: number; stickerId: number; emojiType: string; name: string; describe: string; png: boolean; apng: boolean; lottie: boolean; }

export interface SandboxPageProps {
    readonly renderConversationDetails?: (context: { readonly sessionKey: string; readonly canExecute: boolean; readonly connectionId?: string }) => React.ReactNode
}

export default function Sandbox(props: SandboxPageProps = {}) {
    const [locale, setLocale] = useState<SandboxLocale>('zh-CN')
    const localeRef = useRef<SandboxLocale>('zh-CN')
    const [initialState] = useState(() => createDefaultPlaygroundState())
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
    const [canExecute, setCanExecute] = useState(false)
    const [persistenceStatus, setPersistenceStatus] = useState<'saved' | 'error'>('saved')
    const [directoryStatus, setDirectoryStatus] = useState<DirectoryStatus>({ mode: 'loading', error: null })
    const [workspaceScope, setWorkspaceScope] = useState<SandboxWorkspaceScope | null>(null)
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
    const atSuggestions = [
        { id: 'actor-owner', name: sandboxText(locale, "当前用户") }, { id: 'actor-reviewer', name: sandboxText(locale, "审阅者") },
        { id: 'actor-operator', name: sandboxText(locale, "协作者") }, { id: 'actor-bot', name: 'Sandbox Agent' }
    ]
    const [previewSegments, setPreviewSegments] = useState<MessageSegment[]>([])
    const [composerMode, setComposerMode] = useState<'write' | 'preview'>('write')
    const [showChannelList, setShowChannelList] = useState(false)
    const [showInspector, setShowInspector] = useState(false)
    const [showConversationDetails, setShowConversationDetails] = useState(false)
    const [pendingRefreshEpoch, setPendingRefreshEpoch] = useState(0)
    const [showRunSettings, setShowRunSettings] = useState(false)
    const [showNewSession, setShowNewSession] = useState(false)
    const [newSessionName, setNewSessionName] = useState('')
    const [newSessionScope, setNewSessionScope] = useState<SandboxScope>('private')
    const [confirmClear, setConfirmClear] = useState(false)
    const [trace, setTrace] = useState<AgentTraceSnapshot | null>(null)
    const [traceLoading, setTraceLoading] = useState(true)
    const [traceNotice, setTraceNotice] = useState<string | null>(null)
    const [cancellationFeedback, setCancellationFeedback] = useState<{ kind: 'error' | 'status'; message: string } | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const connectionRef = useRef<{ protocol?: string; connectionId?: string; ownerId?: string; canExecute: boolean }>({ canExecute: false })
    const editorRef = useRef<RichTextEditorRef>(null)
    const traceRef = useRef<AgentTraceSnapshot | null>(null)
    const traceReadOwnerRef = useRef<{
        sessionKey: string; socket: WebSocket | null; controller: AbortController;
        pending?: Promise<void>; cancelRefresh?: ReturnType<typeof window.setTimeout>;
    } | null>(null)
    const activeChannelRef = useRef(activeChannel)
    const endpointIdRef = useRef(endpointId)
    const directoryModeRef = useRef(directoryStatus.mode)
    const directoryHostRef = useRef<string | null>(null)
    const readyWorkingDirectoryRef = useRef('')
    const readyIdentityRef = useRef<{ host: string; ownerId: string } | null>(null)
    const socketRequestContextRef = useRef<SandboxRequestContext | null>(null)
    const directoryControllerRef = useRef<ReturnType<typeof createWorkspaceDirectoryController> | null>(null)
    if (!directoryControllerRef.current) directoryControllerRef.current = createWorkspaceDirectoryController({
        loaded: (directory, sameScope) => {
            const fallback = directory ? createDefaultPlaygroundState(readyWorkingDirectoryRef.current) : loadPlaygroundState()
            const sessions: Channel[] = directory?.items.length
                ? directory.items.map((item) => ({ id: item.id, type: item.type, name: item.name, runConfig: item.runConfig, unread: 0 }))
                : [...fallback.sessions]
            const previous = activeChannelRef.current
            if (sameScope && !sessions.some((session) => session.id === previous.id && session.type === previous.type)) sessions.push(previous)
            const selected = sameScope
                ? sessions.find((session) => session.id === previous.id && session.type === previous.type)!
                : sessions.find((session) => session.id === fallback.activeSessionId && session.type === fallback.activeSessionType) ?? sessions[0]!
            activeChannelRef.current = selected
            setActiveChannel(selected)
            if (!sameScope) setMessages(directory ? [] : [...fallback.messages])
            setChannels(sessions)
            setWorkspaceScope(directory?.scope ?? null)
            subscribeToScene(selected)
        },
        status: (status) => {
            directoryModeRef.current = status.mode
            setDirectoryStatus(status)
            if (status.error) setPersistenceStatus('error')
            else if (status.mode === 'server') setPersistenceStatus('saved')
        },
    })
    const sessionKey = useMemo(
        () => buildSandboxSessionKey(endpointId, activeChannel.type, activeChannel.id),
        [activeChannel.id, activeChannel.type, endpointId],
    )
    const history = useSandboxHistory(canExecute && directoryStatus.mode === 'server' && workspaceScope
        && workspaceScope.connectionId === connectionRef.current.connectionId ? {
            connectionId: workspaceScope.connectionId, sessionKey, scope: workspaceScope.endpoint,
            scene: { id: activeChannel.id, type: activeChannel.type, name: activeChannel.name },
            ownerId: workspaceScope.ownerId, requestContext: socketRequestContextRef.current ?? undefined,
        } : undefined, setMessages, locale)
    const retireTraceReads = () => {
        const owner = traceReadOwnerRef.current
        traceReadOwnerRef.current = null
        owner?.controller.abort()
        if (owner?.cancelRefresh !== undefined) window.clearTimeout(owner.cancelRefresh)
        traceRef.current = null
    }
    const currentTraceOwner = () => {
        const scene = activeChannelRef.current
        const key = buildSandboxSessionKey(endpointIdRef.current, scene.type, scene.id)
        let owner = traceReadOwnerRef.current
        if (!owner || owner.sessionKey !== key || owner.socket !== wsRef.current) {
            retireTraceReads()
            owner = { sessionKey: key, socket: wsRef.current, controller: new AbortController() }
            traceReadOwnerRef.current = owner
            setTrace(null)
            setTraceNotice(null)
            setCancellationFeedback(null)
            setStoppingTask(false)
        }
        return owner
    }
    const ownsCurrentTrace = (owner: NonNullable<typeof traceReadOwnerRef.current>) => {
        const scene = activeChannelRef.current
        return traceReadOwnerRef.current === owner && !owner.controller.signal.aborted
            && owner.socket === wsRef.current
            && owner.sessionKey === buildSandboxSessionKey(endpointIdRef.current, scene.type, scene.id)
    }
    const traceSummary = useMemo(() => summarizeTrace(trace), [trace])
    const taskRuns = useMemo(() => deriveTaskRuns(trace), [trace])
    const workbenchArtifacts = useMemo(() => deriveWorkbenchArtifacts(trace, locale), [trace, locale])
    const currentTask = taskRuns.find((run) => run.status === 'running') ?? taskRuns[0]
    const currentRunSteps = useMemo(() => deriveAgentRunSteps(trace, currentTask, locale), [currentTask, trace, locale])
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
        if (directoryModeRef.current !== 'browser') return
        setPersistenceStatus(savePlaygroundState({
            activeSessionId: activeChannel.id,
            activeSessionType: activeChannel.type,
            sessions: channels,
            messages,
        }) ? 'saved' : 'error')
    }, [activeChannel.id, channels, messages, directoryStatus.mode])

    const fetchFaceList = async () => {
        try { const res = await fetch('https://face.viki.moe/metadata.json'); setFaceList(await res.json()) }
        catch (err) { console.error('[Sandbox] Failed to fetch face list:', err) }
    }

    useEffect(() => { fetchFaceList() }, [])

    const subscribeToScene = (scene: Pick<Channel, 'id' | 'type'>) => {
        // Old Hosts parse unknown JSON as chat, so control frames require this explicit handshake.
        if (connectionRef.current.protocol !== SANDBOX_SCOPED_PROTOCOL || !connectionRef.current.canExecute) return
        if (!submitSandboxFrame(wsRef.current, { op: 'subscribe', conversation: { type: scene.type, id: scene.id } })) {
            setTransportNotice(sandboxText(localeRef.current, "Sandbox 连接尚未就绪，会话切换未发送。"))
        }
    }

    const handleInboundPayload = (data: {
        type: string; id: string; locale?: unknown; content?: unknown; endpoint?: string; workingDirectory?: string; canExecute?: boolean;
        shellIsolation?: { available?: boolean; provider?: string; message?: string }; timestamp: number;
        messageId?: string; bot?: string; protocol?: string; connectionId?: string; direction?: string; senderId?: string;
        conversation?: { type: Channel['type']; id: string };
    }) => {
        const locale = data.type === 'ready' && data.locale === 'en' ? 'en' : data.type === 'ready' ? 'zh-CN' : localeRef.current
        if (data.type === 'ready') {
            localeRef.current = locale
            setLocale(locale)
            const requestContext = socketRequestContextRef.current ?? captureSandboxRequestContext()
            const host = requestContext.apiBase || window.location.origin
            const previousIdentity = readyIdentityRef.current
            if (previousIdentity && (previousIdentity.host !== host || previousIdentity.ownerId !== data.id)) {
                const fresh = createDefaultPlaygroundState(data.workingDirectory?.trim())
                activeChannelRef.current = fresh.sessions[0]!
                setActiveChannel(fresh.sessions[0]!)
                setChannels([...fresh.sessions])
                setMessages([])
            }
            readyIdentityRef.current = { host, ownerId: data.id }
            endpointIdRef.current = data.endpoint || data.bot || 'sandbox-bot'
            setBotName(endpointIdRef.current)
            connectionRef.current = { protocol: data.protocol, connectionId: data.connectionId, ownerId: data.id, canExecute: data.canExecute !== false }
            setCanExecute(data.canExecute !== false)
            setTransportNotice(data.canExecute === false ? sandboxText(locale, "当前 Token 只有演示权限，任务运行已禁用。") : null)
            if (data.shellIsolation) {
                setShellIsolation({
                    available: data.shellIsolation.available === true,
                    provider: data.shellIsolation.provider || 'docker',
                    message: data.shellIsolation.message || sandboxText(locale, "未检测到隔离执行环境"),
                })
            }
            readyWorkingDirectoryRef.current = data.workingDirectory?.trim() ?? ''
            void directoryControllerRef.current!.begin({ host,
                connectionId: data.connectionId, canExecute: data.canExecute !== false, requestContext })
            return
        }
        if (data.type === 'subscribed') return
        if (data.type === 'error') {
            setPendingRefreshEpoch((epoch) => epoch + 1)
            const notice = Array.isArray(data.content)
                ? String((data.content[0] as { data?: { text?: unknown } } | undefined)?.data?.text ?? sandboxText(locale, "Sandbox 拒绝了本次操作"))
                : String(data.content ?? sandboxText(locale, "Sandbox 拒绝了本次操作"))
            setTransportNotice(notice)
            return
        }
        if (data.type === 'edit' && data.messageId) {
            const content: MessageSegment[] = Array.isArray(data.content)
                ? data.content as MessageSegment[]
                : parseTextToSegments(String(data.content ?? ''))
            const scene = data.conversation ?? activeChannelRef.current
            if (!data.conversation && data.id && data.id !== scene.id) return
            setMessages((prev) => prev.map((message) => message.id === data.messageId
                && message.channelType === scene.type && message.channelId === scene.id && message.type === 'received'
                ? { ...message, content } : message))
            return
        }

        // A received message invalidates the projection; only Core decides whether a claim remains live.
        setPendingRefreshEpoch((epoch) => epoch + 1)
        const content: MessageSegment[] = typeof data.content === 'string'
            ? parseTextToSegments(data.content)
            : Array.isArray(data.content) ? data.content as MessageSegment[] : parseTextToSegments(String(data.content ?? ''))

        const channelType: Channel['type'] = data.conversation?.type ?? (data.type === 'group' || data.type === 'channel' ? data.type : 'private')
        const sceneId = data.conversation?.id ?? data.id
        const isInput = data.direction === 'inbound'
        // Interactive choices are transport inputs, not another chat turn or an approval result.
        if (isInput && content.every((segment) => segment.type === 'action')) return
        const channelName = channelType === 'private'
            ? sandboxText(locale, "会话 {0}", [sceneId])
            : channelType === 'group'
            ? sandboxText(locale, "群组场景 {0}", [sceneId])
            : sandboxText(locale, "频道场景 {0}", [sceneId])

        setChannels((prev) => {
            if (prev.some((c) => c.id === sceneId && c.type === channelType)) return prev
            const created: Channel = {
                id: sceneId, name: channelName, type: channelType, unread: 0,
                runConfig: { ...activeChannelRef.current.runConfig },
            }
            activeChannelRef.current = created
            setActiveChannel(created)
            return [...prev, created]
        })

        setMessages((prev) => mergePlaygroundMessage(prev, {
            id: data.messageId ?? createSandboxMessageId(), type: isInput ? 'sent' : 'received', channelType,
            interactionReadOnly: false,
            channelId: sceneId, channelName, senderId: isInput ? data.senderId || connectionRef.current.ownerId || 'owner' : 'endpoint',
            senderName: isInput ? sandboxText(locale, "当前用户") : data.bot || endpointIdRef.current, content, timestamp: data.timestamp,
        }))
    }

    const sendInteractiveAction = (payload: string, messageId?: string) => {
        if (!connectionRef.current.canExecute) return false
        const scene = activeChannelRef.current
        const segments: MessageSegment[] = [{ type: 'action', data: { id: payload, payload } }]
        if (!submitSandboxFrame(wsRef.current, {
            type: scene.type, id: scene.id, messageId: createSandboxMessageId(), content: segments,
            agentRun: scene.runConfig, timestamp: Date.now(),
        })) {
            setTransportNotice(sandboxText(localeRef.current, "Sandbox 连接尚未就绪，审批选择未发送。"))
            return false
        }
        if (messageId) {
            setMessages((current) => current.map((message) => message.id === messageId
                && message.channelType === scene.type && message.channelId === scene.id && message.type === 'received'
                ? { ...message, interactionResolved: true } : message))
        }
        return true
    }

    useEffect(() => {
        let closed = false
        let retryTimer: ReturnType<typeof setTimeout> | undefined
        let attempt = 0
        /** Ignore close events from a socket we intentionally replaced (login/base change). */
        let replaceInFlight = false

        const connect = () => {
            if (closed) return
            retireTraceReads()
            directoryControllerRef.current?.retire()
            directoryModeRef.current = 'loading'
            setDirectoryStatus({ mode: 'loading', error: null })
            setWorkspaceScope(null)
            const requestContext = captureSandboxRequestContext()
            const nextHost = requestContext.apiBase || window.location.origin
            if (directoryHostRef.current !== nextHost) {
                const fresh = createDefaultPlaygroundState()
                activeChannelRef.current = fresh.sessions[0]!
                setActiveChannel(fresh.sessions[0]!)
                setChannels([...fresh.sessions])
                setMessages([])
            }
            directoryHostRef.current = nextHost
            if (retryTimer) {
                clearTimeout(retryTimer)
                retryTimer = undefined
            }
            connectionRef.current = { canExecute: false }
            setCanExecute(false)
            setConnected(false)
            const wsUrl = buildSandboxWebSocketUrl(nextHost)
            // This page owns one connection; replacing its credentials must retire only that socket.
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
            socketRequestContextRef.current = requestContext
            wsRef.current = ws
            void loadTrace()
            ws.onopen = () => {
                if (wsRef.current !== ws) return
                attempt = 0
                setConnected(true)
            }
            ws.onmessage = (event) => {
                if (wsRef.current !== ws) return
                try { handleInboundPayload(JSON.parse(String(event.data))) }
                catch (err) { console.error('[Sandbox] Failed to parse message:', err) }
            }
            ws.onclose = () => {
                if (wsRef.current !== ws) return
                retireTraceReads()
                directoryControllerRef.current?.retire()
                directoryModeRef.current = 'loading'
                setDirectoryStatus({ mode: 'loading', error: null })
                setWorkspaceScope(null)
                setConnected(false)
                setCanExecute(false)
                connectionRef.current = { canExecute: false }
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
            retireTraceReads()
            directoryControllerRef.current?.retire()
            if (retryTimer) clearTimeout(retryTimer)
            if (typeof window !== 'undefined') {
                window.removeEventListener('storage', onAuthOrStorage)
                window.removeEventListener('zhin:auth-required', onAuthOrStorage)
                window.removeEventListener('zhin:auth-changed', onAuthOrStorage)
                window.removeEventListener('zhin:api-base-changed', onAuthOrStorage)
            }
            wsRef.current?.close()
            wsRef.current = null
            connectionRef.current = { canExecute: false }
            setCanExecute(false)
            setConnected(false)
        }
    }, [])

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
    useEffect(() => { setPreviewSegments(inputText.trim() ? parseTextToSegments(inputText) : []) }, [inputText])

    const loadTrace = useCallback(async (quiet = false) => {
        const owner = currentTraceOwner()
        const locale = localeRef.current
        if (!quiet) setTraceLoading(true)
        if (owner.pending) return owner.pending
        owner.pending = (async () => {
            try {
                const current = traceRef.current?.sessionKey === owner.sessionKey ? traceRef.current : null
                let incoming = await fetchAgentTrace(owner.sessionKey, quiet ? current?.latestSequence ?? 0 : 0, locale, owner.controller.signal)
                if (!ownsCurrentTrace(owner)) return
                if (quiet && current?.runtimeId && incoming.runtimeId && current.runtimeId !== incoming.runtimeId) {
                    incoming = await fetchAgentTrace(owner.sessionKey, 0, locale, owner.controller.signal)
                    if (!ownsCurrentTrace(owner)) return
                }
                const baseline = traceRef.current?.sessionKey === owner.sessionKey ? traceRef.current : null
                const merged = mergeTraceSnapshot(baseline, incoming)
                traceRef.current = merged
                setTrace(merged)
                saveCachedAgentTrace(merged)
                setTraceNotice(null)
            } catch (error) {
                if (ownsCurrentTrace(owner)) setTraceNotice(error instanceof Error ? error.message : sandboxText(locale, "Agent Trace 暂不可用"))
            } finally {
                owner.pending = undefined
                if (ownsCurrentTrace(owner)) setTraceLoading(false)
            }
        })()
        return owner.pending
    }, [])

    useEffect(() => {
        const owner = currentTraceOwner()
        const cached = loadCachedAgentTrace(sessionKey)
        // Cached display is not an incremental baseline for this connection.
        setTrace(cached)
        setTraceNotice(null)
        void loadTrace()
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void loadTrace(true)
        }, 2_000)
        return () => {
            window.clearInterval(timer)
            if (traceReadOwnerRef.current === owner) retireTraceReads()
        }
    }, [sessionKey, loadTrace])

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
        onInteractionSubmitted?: () => void,
        allowInteraction = true,
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
                case 'html':
                    return <HtmlMessage locale={locale} key={index} html={String(d.html ?? '')} />
                case 'code':
                    return <CodeBlock key={index} code={String(d.code ?? d.text ?? d.content ?? '')} language={String(d.language ?? d.lang ?? '')} />
                case 'mention':
                case 'at':
                    return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-xs mx-0.5">@{String(d.name ?? d.target ?? d.qq ?? '')}</span>
                case 'face':
                    return <img key={index} src={`https://face.viki.moe/apng/${d.id}.png`} alt={String(d.name ?? '')} className="w-6 h-6 inline-block align-middle mx-0.5" title={String(d.name ?? d.id ?? '')} />
                case 'dice':
                    return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-xs mx-0.5">🎲 {d.result != null ? sandboxText(locale, "点数 {0}", [String(d.result)]) : sandboxText(locale, "骰子")}</span>
                case 'rps':
                    return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-xs mx-0.5">✊ {d.result != null ? sandboxText(locale, "结果 {0}", [String(d.result)]) : sandboxText(locale, "猜拳")}</span>
                case 'image': {
                    const raw = pickMediaRawUrl(d)
                    const src = resolveMediaSrc(raw, 'image')
                    if (!src) return <span key={index} className="text-xs opacity-70">{sandboxText(locale, "[图片]")}</span>
                    return (
                        // resolveMediaSrc allowlists non-executable URL schemes and image data MIME types.
                        // lgtm[js/xss,js/client-side-unvalidated-url-redirection]
                        <a key={index} href={src} target="_blank" rel="noreferrer" className="block my-1">
                            {/* lgtm[js/xss,js/client-side-unvalidated-url-redirection] */}
                            <img src={src} alt="" className={cn('max-w-[min(320px,88vw)] rounded-lg block', ring, 'ring-offset-0')} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        </a>
                    )
                }
                case 'video': {
                    const raw = pickMediaRawUrl(d)
                    const src = resolveMediaSrc(raw, 'video')
                    if (!src) return <span key={index} className="text-xs opacity-70">{sandboxText(locale, "[视频无地址]")}</span>
                    return (
                        // resolveMediaSrc allowlists non-executable URL schemes and video data MIME types.
                        // lgtm[js/xss,js/client-side-unvalidated-url-redirection]
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
                    if (!src) return <span key={index} className="text-xs opacity-70">{sandboxText(locale, "[音频无地址]")}</span>
                    return (
                        // resolveMediaSrc allowlists non-executable URL schemes and audio data MIME types.
                        // lgtm[js/xss,js/client-side-unvalidated-url-redirection]
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
                            {sandboxText(locale, "↩ 引用消息 #")}{String(d.message_id ?? d.id ?? '')}
                        </div>
                    )
                case 'forward': {
                    const messages = d.messages as Array<Array<{ type?: string; data?: Record<string, unknown> }>> | undefined
                    const title = String(d.title ?? sandboxText(locale, "聊天记录"))
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
                                    {messages.length > 3 && <div className="opacity-60">{sandboxText(locale, "…共")}{messages.length} {sandboxText(locale, "条")}</div>}
                                </div>
                            ) : (
                                <div className="opacity-70">{sandboxText(locale, "[合并转发]")}</div>
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
                                            disabled={btn.disabled || isSent || resolved || !canExecute || !allowInteraction}
                                            onClick={() => { if (sendInteractiveAction(btn.payload, messageId)) onInteractionSubmitted?.() }}
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
                            {resolved && <small><Check size={12} />{sandboxText(locale, "已提交本次选择")}</small>}
                        </div>
                    )
                }
                default:
                    return <span key={index} className="text-xs opacity-70">[{segment.type}]</span>
            }
        })
    }

    const handleSendMessage = (_text: string, segments: MessageSegment[]) => {
        if (!connectionRef.current.canExecute || directoryModeRef.current === 'loading' || !hasRenderableSegments(segments)) return
        const scene = activeChannelRef.current
        const newMessage: Message = {
            id: createSandboxMessageId(), type: 'sent', channelType: scene.type, channelId: scene.id,
            channelName: scene.name, senderId: connectionRef.current.ownerId || 'test_user',
            senderName: sandboxText(localeRef.current, "测试用户"), content: segments, timestamp: Date.now(),
        }
        if (!submitSandboxFrame(wsRef.current, {
            type: scene.type, id: scene.id, messageId: newMessage.id, content: segments,
            agentRun: scene.runConfig, timestamp: newMessage.timestamp,
        })) {
            setTransportNotice(sandboxText(localeRef.current, "Sandbox 连接尚未就绪，消息未发送。"))
            return
        }
        void directoryControllerRef.current?.save(scene, true)
        setPendingRefreshEpoch((epoch) => epoch + 1)
        setMessages((prev) => mergePlaygroundMessage(prev, newMessage))
        setInputText(''); setPreviewSegments([]); setComposerMode('write')
        editorRef.current?.clear()
    }


    const clearMessages = () => {
        setMessages((current) => current.filter((message) => !(
            message.channelId === activeChannel.id && message.channelType === activeChannel.type
        )))
        setConfirmClear(false)
    }
    const switchChannel = (channel: Channel) => {
        activeChannelRef.current = channel
        subscribeToScene(channel)
        setActiveChannel(channel)
        setChannels((prev) => prev.map((c) => c.id === channel.id && c.type === channel.type ? { ...c, unread: 0 } : c))
        if (window.innerWidth < 900) setShowChannelList(false)
    }
    const updateRunConfig = (patch: Partial<SandboxAgentRunConfig>) => {
        if (directoryModeRef.current === 'loading') return
        const current = activeChannelRef.current
        const next = { ...current, runConfig: { ...current.runConfig, ...patch } }
        activeChannelRef.current = next
        setActiveChannel(next)
        setChannels((sessions) => sessions.map((session) => session.id === current.id && session.type === current.type ? next : session))
        void directoryControllerRef.current?.save(next)
    }
    const addSession = () => {
        if (directoryModeRef.current === 'loading') return
        const label = newSessionName.trim() || sandboxText(locale, "未命名试验")
        const id = `${newSessionScope}-${createSandboxMessageId()}`
        const session: Channel = {
            id, name: label, type: newSessionScope, unread: 0,
            runConfig: { ...activeChannel.runConfig },
        }
        setChannels((current) => [...current, session])
        activeChannelRef.current = session
        subscribeToScene(session)
        setActiveChannel(session)
        void directoryControllerRef.current?.save(session)
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
    const scopeLabel = activeChannel.type === 'private' ? sandboxText(locale, "单用户") : activeChannel.type === 'group' ? sandboxText(locale, "群组上下文") : sandboxText(locale, "频道上下文")
    const runPrompt = (prompt: string) => handleSendMessage(prompt, [{ type: 'text', data: { text: prompt } }])
    const recentTraceEvents = trace?.events.slice(-8).reverse() ?? []
    const stopActiveTask = async () => {
        const owner = currentTraceOwner()
        setCancellationFeedback(null)
        setStoppingTask(true)
        try {
            const cancelled = await cancelAgentTask(owner.sessionKey, locale)
            if (!ownsCurrentTrace(owner)) return
            setCancellationFeedback({ kind: 'status', message: cancelled ? sandboxText(locale, "停止请求已提交。") : sandboxText(locale, "当前会话没有运行中的任务。") })
            if (owner.cancelRefresh !== undefined) window.clearTimeout(owner.cancelRefresh)
            owner.cancelRefresh = window.setTimeout(() => {
                owner.cancelRefresh = undefined
                if (ownsCurrentTrace(owner)) void loadTrace(true)
            }, 240)
        } catch (error) {
            if (!ownsCurrentTrace(owner)) return
            setCancellationFeedback({ kind: 'error', message: error instanceof Error ? error.message : sandboxText(locale, "无法停止任务") })
            setShowInspector(true)
        } finally {
            if (ownsCurrentTrace(owner)) setStoppingTask(false)
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
        }, locale)
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
                    <h3>{taskStatusLabel(currentTask.status, locale)}</h3>
                    {currentTaskMessage && <p>{messageText(currentTaskMessage.content)}</p>}
                </div>
                <div className="agent-playground-inline-run-actions">
                    {currentTask.status === 'running' ? (
                        <button type="button" className="is-stop" onClick={() => void stopActiveTask()} disabled={stoppingTask}><Square size={12} />{stoppingTask ? sandboxText(locale, "停止中") : sandboxText(locale, "停止")}</button>
                    ) : currentTaskMessage ? (
                        <button type="button" onClick={retryCurrentTask}><RotateCcw size={13} />{sandboxText(locale, "重试")}</button>
                    ) : null}
                    <button type="button" onClick={exportCurrentRun} title={sandboxText(locale, "导出 Markdown 运行报告")}><FileDown size={13} />{sandboxText(locale, "导出")}</button>
                </div>
            </div>
            <dl className="agent-playground-inline-run-metrics">
                <div><dt>{sandboxText(locale, "耗时")}</dt><dd>{currentTask.durationMs === undefined ? sandboxText(locale, "进行中") : formatDuration(currentTask.durationMs, locale)}</dd></div>
                <div><dt>{sandboxText(locale, "步骤")}</dt><dd>{currentRunSteps.length}</dd></div>
                <div><dt>{sandboxText(locale, "工具")}</dt><dd>{currentTask.toolCount}</dd></div>
                <div><dt>Token</dt><dd>{currentTask.tokenCount.toLocaleString(locale)}</dd></div>
                <div className={cn(currentTask.problemCount > 0 && 'has-problem')}><dt>{sandboxText(locale, "异常")}</dt><dd>{currentTask.problemCount}</dd></div>
            </dl>
            {inlineRunExpanded && (
                currentRunSteps.length > 0 ? (
                    <ol className="agent-playground-inline-run-steps">
                        {currentRunSteps.map((step) => (
                            <li key={step.id} className={cn(`is-${step.status}`)}>
                                <i aria-hidden="true" />
                                <div><strong>{step.title}</strong>{step.detail && <small>{step.detail}</small>}</div>
                                <span>{step.durationMs === undefined ? runStepStatusLabel(step.status, locale) : formatDuration(step.durationMs, locale)}</span>
                            </li>
                        ))}
                    </ol>
                ) : <div className="agent-playground-inline-run-empty">{sandboxText(locale, "正在等待第一条运行事件…")}</div>
            )}
            <footer>
                <button type="button" aria-expanded={inlineRunExpanded} onClick={() => setInlineRunExpanded((expanded) => !expanded)}>
                    <ChevronDown size={13} />{inlineRunExpanded ? sandboxText(locale, "收起步骤") : sandboxText(locale, "查看 {0} 个步骤", [currentRunSteps.length])}
                </button>
                <button type="button" onClick={() => { setInspectorView(currentRunArtifacts.length > 0 ? 'artifacts' : 'runs'); setShowInspector(true) }}>
                    {currentRunArtifacts.length > 0 ? sandboxText(locale, "{0} 个变更与产物", [currentRunArtifacts.length]) : sandboxText(locale, "打开运行检查器")}<PanelRight size={13} />
                </button>
            </footer>
        </article>
    ) : null

    const recoveryConnectionId = connectionRef.current.connectionId
    return (
        <section className={cn("agent-playground-shell", showInspector && "has-inspector")}>
            <div className="agent-playground-mobilebar">
                <button type="button" aria-expanded={showChannelList} onClick={() => setShowChannelList(!showChannelList)}><MessageSquare size={17} />{sandboxText(locale, "会话列表")}</button>
                <strong>{sandboxText(locale, "会话")}</strong>
                <button type="button" aria-expanded={showInspector} aria-controls="sandbox-run-inspector" onClick={() => setShowInspector(!showInspector)}><PanelRight size={17} />{sandboxText(locale, "检查器")}</button>
            </div>

            <nav className={cn("channel-sidebar agent-playground-sessions", showChannelList && "show")} aria-label={sandboxText(locale, "会话列表")}>
                <div className="agent-playground-brand">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="agent-playground-mark"><Sparkles size={16} /></span>
                            <div><h2>{sandboxText(locale, "会话")}</h2><small>Conversations</small></div>
                        </div>
                        <span className={cn("agent-playground-connection", connected && "is-online")} title={connected ? sandboxText(locale, "Sandbox WebSocket 已连接") : sandboxText(locale, "正在重连 Sandbox WebSocket")}>
                            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                        </span>
                    </div>
                </div>

                <div className="agent-playground-section-label"><span>{sandboxText(locale, "会话列表")}</span><span>{channels.length}</span><button type="button" disabled={directoryStatus.mode === 'loading'} aria-label={sandboxText(locale, "刷新会话目录")} onClick={() => void directoryControllerRef.current?.refresh()}><RefreshCw size={13} /></button></div>
                <div className="agent-playground-session-list">
                    {channels.map((channel) => {
                        const isActive = activeChannel.id === channel.id && activeChannel.type === channel.type
                        return (
                            <button type="button" key={`${channel.type}:${channel.id}`} disabled={directoryStatus.mode === 'loading'} aria-current={isActive ? 'page' : undefined} className={cn("agent-playground-session", isActive && "active")} onClick={() => switchChannel(channel)}>
                                <span className="agent-playground-session-icon">{getChannelIcon(channel.type)}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{channel.name}</div>
                                    <div className="text-xs text-muted-foreground">{channel.type === 'private' ? sandboxText(locale, "单用户作用域") : channel.type === 'group' ? sandboxText(locale, "群组作用域") : sandboxText(locale, "频道作用域")}</div>
                                </div>
                                {channel.unread > 0 && <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1">{channel.unread}</span>}
                            </button>
                        )
                    })}
                </div>

                <div className="agent-playground-new-session">
                    {showNewSession ? (
                        <div className="agent-playground-new-form">
                            <input value={newSessionName} onChange={(event) => setNewSessionName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addSession() }} placeholder={sandboxText(locale, "会话名称")} autoFocus />
                            <div className="agent-playground-scope-picker" role="group" aria-label={sandboxText(locale, "消息作用域")}>
                                {(['private', 'group', 'channel'] as SandboxScope[]).map((scope) => (
                                    <button type="button" key={scope} aria-pressed={newSessionScope === scope} className={cn(newSessionScope === scope && 'active')} onClick={() => setNewSessionScope(scope)}>
                                        {scope === 'private' ? sandboxText(locale, "单用户") : scope === 'group' ? sandboxText(locale, "群组") : sandboxText(locale, "频道")}
                                    </button>
                                ))}
                            </div>
                            <div className="agent-playground-new-actions">
                                <button type="button" onClick={() => setShowNewSession(false)}>{sandboxText(locale, "取消")}</button>
                                <button type="button" className="primary" onClick={addSession}>{sandboxText(locale, "创建")}</button>
                            </div>
                        </div>
                    ) : (
                        <button type="button" disabled={directoryStatus.mode === 'loading'} className="agent-playground-add" onClick={() => setShowNewSession(true)}><Plus size={15} />{sandboxText(locale, "新建会话")}</button>
                    )}
                </div>
                <div className="agent-playground-endpoint">
                    <span>{directoryStatus.mode === 'loading' ? sandboxText(locale, "正在读取会话目录") : directoryStatus.mode === 'server' && !directoryStatus.error ? sandboxText(locale, "Host 会话目录") : persistenceStatus === 'saved' ? sandboxText(locale, "会话已持久化") : sandboxText(locale, "会话保存失败")}</span>
                    <strong>{endpointId}</strong>
                </div>
            </nav>

            {showChannelList && <div className="channel-overlay" onClick={() => setShowChannelList(false)} />}

            <main className="chat-area agent-playground-main">
                <header className="agent-playground-runbar">
                    <div className="agent-playground-run-identity">
                        <span className="agent-playground-run-icon">{getChannelIcon(activeChannel.type)}</span>
                        <div title={sessionKey}>
                            <div className="agent-playground-run-title"><h1 title={activeChannel.name}>{activeChannel.name}</h1><span>{scopeLabel}</span></div>
                        </div>
                    </div>
                    <div className="agent-playground-run-actions">
                        <span className={cn("agent-playground-run-state", currentTask?.status === 'running' && "is-running", currentTask?.status === 'failed' && 'has-problem')}>
                            {currentTask?.status === 'running' ? <Activity size={14} /> : <Gauge size={14} />}
                            {currentTask ? taskStatusLabel(currentTask.status, locale) : sandboxText(locale, "{0} 条消息", [channelMessages.length])}
                        </span>
                        {currentTask?.status === 'running' ? (
                            <button type="button" className="agent-playground-stop" onClick={() => void stopActiveTask()} disabled={stoppingTask} aria-label={sandboxText(locale, "停止当前任务")}><Square size={13} />{stoppingTask ? sandboxText(locale, "停止中") : sandboxText(locale, "停止")}</button>
                        ) : lastUserMessage ? (
                            <button type="button" onClick={retryLastTask} aria-label={sandboxText(locale, "重新运行上一个任务")}><RotateCcw size={14} />{sandboxText(locale, "重试")}</button>
                        ) : null}
                        {props.renderConversationDetails
                            ? <button type="button" disabled={!canExecute} aria-expanded={showConversationDetails} aria-controls="sandbox-conversation-details" onClick={() => setShowConversationDetails((visible) => !visible)}><ListChecks size={14} />{sandboxText(locale, "对话与轨迹")}</button>
                            : <a href={agentSessionsPath(sessionKey)}><ExternalLink size={14} />{sandboxText(locale, "对话与轨迹")}</a>}
                        <button type="button" className={cn(showRunSettings && 'active')} aria-expanded={showRunSettings} onClick={() => setShowRunSettings((visible) => !visible)} aria-label={sandboxText(locale, "配置运行环境")}><SlidersHorizontal size={16} /></button>
                        <button type="button" aria-expanded={showInspector} aria-controls="sandbox-run-inspector" onClick={() => setShowInspector(!showInspector)} aria-label={sandboxText(locale, "切换运行检查器")}><PanelRight size={16} /></button>
                        <button type="button" onClick={() => setConfirmClear(true)} aria-label={sandboxText(locale, "清空当前会话")}><Trash2 size={15} /></button>
                    </div>
                </header>

                {cancellationFeedback && <div className="agent-playground-confirm" role={cancellationFeedback.kind === 'error' ? 'alert' : 'status'}>
                    <div><span>{cancellationFeedback.message}</span></div>
                    <button type="button" onClick={() => setCancellationFeedback(null)}>{sandboxText(locale, "知道了")}</button>
                </div>}

                {confirmClear && (
                    <div className="agent-playground-confirm" role="alert">
                        <div><strong>{sandboxText(locale, "清空当前测试记录？")}</strong><span>{sandboxText(locale, "只移除“")}{activeChannel.name}{sandboxText(locale, "”在浏览器中的消息，不影响 Agent 会话存储。")}</span></div>
                        <button type="button" onClick={() => setConfirmClear(false)}>{sandboxText(locale, "取消")}</button>
                        <button type="button" className="danger" onClick={clearMessages}>{sandboxText(locale, "确认清空")}</button>
                    </div>
                )}

                {transportNotice && (
                    <div className="agent-playground-confirm" role="status">
                        <div><strong>{sandboxText(locale, "运行暂不可用")}</strong><span>{transportNotice}</span></div>
                        <button type="button" onClick={() => setTransportNotice(null)}>{sandboxText(locale, "知道了")}</button>
                    </div>
                )}

                {directoryStatus.error && <div className="agent-playground-confirm" role="alert">
                    <div><strong>{sandboxText(locale, "会话目录")}</strong><span>{directoryStatus.error}</span></div>
                    <button type="button" onClick={() => void directoryControllerRef.current?.refresh()}>{sandboxText(locale, "重新读取")}</button>
                </div>}

                {showRunSettings && (
                    <section className="agent-playground-run-settings" aria-label={sandboxText(locale, "运行配置")}>
                        <label className="agent-playground-directory-field">
                            <span><FolderOpen size={14} />{sandboxText(locale, "工作目录")}</span>
                            <input
                                disabled={directoryStatus.mode === 'loading'}
                                value={activeChannel.runConfig.workingDirectory}
                                onChange={(event) => updateRunConfig({ workingDirectory: event.target.value })}
                                placeholder={sandboxText(locale, "使用 Host 项目目录")}
                                spellCheck={false}
                            />
                        </label>
                        <label>
                            <span><ShieldCheck size={14} />{sandboxText(locale, "安全策略")}</span>
                            <select disabled={directoryStatus.mode === 'loading'} value={activeChannel.runConfig.safetyMode} onChange={(event) => {
                                const safetyMode = event.target.value as SandboxAgentRunConfig['safetyMode']
                                updateRunConfig({ safetyMode, ...(safetyMode === 'danger-full-access' ? { networkAccess: true } : {}) })
                            }}>
                                <option value="read-only">{sandboxText(locale, "只读")}</option>
                                <option value="workspace-write">{sandboxText(locale, "工作区写入")}</option>
                                <option value="danger-full-access">{sandboxText(locale, "完全访问")}</option>
                            </select>
                        </label>
                        <label>
                            <span>{sandboxText(locale, "审批策略")}</span>
                            <select
                                value={activeChannel.runConfig.safetyMode === 'read-only' ? 'auto' : activeChannel.runConfig.safetyMode === 'danger-full-access' ? 'bypass' : activeChannel.runConfig.approvalMode}
                                disabled={activeChannel.runConfig.safetyMode !== 'workspace-write'}
                                onChange={(event) => updateRunConfig({ approvalMode: event.target.value as SandboxAgentRunConfig['approvalMode'] })}
                            >
                                <option value="ask">{sandboxText(locale, "按需确认")}</option>
                                <option value="auto">{sandboxText(locale, "审核 Agent 自动判断")}</option>
                                <option value="bypass">{sandboxText(locale, "绕过审批")}</option>
                            </select>
                        </label>
                        <label className="agent-playground-network-toggle">
                            <span><Network size={14} />{sandboxText(locale, "网络访问")}</span>
                            <input
                                type="checkbox"
                                checked={activeChannel.runConfig.safetyMode === 'danger-full-access' || activeChannel.runConfig.networkAccess}
                                disabled={activeChannel.runConfig.safetyMode === 'danger-full-access'}
                                onChange={(event) => updateRunConfig({ networkAccess: event.target.checked })}
                            />
                            <i aria-hidden="true" />
                        </label>
                        {activeChannel.runConfig.safetyMode === 'danger-full-access' && (
                            <p><CircleAlert size={14} />{sandboxText(locale, "完全访问允许 Agent 操作工作目录之外的文件并访问网络，请仅用于可信任务。")}</p>
                        )}
                        {activeChannel.runConfig.safetyMode !== 'danger-full-access' && shellIsolation?.available === false && (
                            <p><CircleAlert size={14} />{sandboxText(locale, "安全 Shell 需要可用的 Docker daemon；当前仅文件工具可运行。")}{shellIsolation.message}</p>
                        )}
                    </section>
                )}

                {canExecute && recoveryConnectionId && (
                    <ConversationRecoveryPanel key={JSON.stringify([recoveryConnectionId, sessionKey])}
                        connectionId={recoveryConnectionId} sessionKey={sessionKey} locale={locale} hidden={showConversationDetails}
                        pendingRefreshEpoch={pendingRefreshEpoch}
                        onRetiredInteractions={(retired) => {
                            const segments = retired.flatMap(interaction => interaction.segments)
                            setMessages(previous => {
                                const current = activeChannelRef.current
                                if (connectionRef.current.connectionId !== recoveryConnectionId
                                    || buildSandboxSessionKey(endpointIdRef.current, current.type, current.id) !== sessionKey) return previous
                                return retirePlaygroundInteractions(previous, activeChannel, segments)
                            })
                        }}
                        requestContext={socketRequestContextRef.current ?? undefined}
                        renderInteraction={(segments, id, submitted, onSubmitted) => renderMessageSegments(segments, false, id, submitted, onSubmitted)} />
                )}

                {showConversationDetails && props.renderConversationDetails && (
                    <section id="sandbox-conversation-details" className="agent-playground-conversation-details" aria-label={sandboxText(locale, "对话与轨迹")}>
                        <button type="button" className="agent-playground-details-back" onClick={() => setShowConversationDetails(false)}><MessageSquare size={14} />{sandboxText(locale, "返回会话")}</button>
                        {props.renderConversationDetails({ sessionKey, canExecute, connectionId: connectionRef.current.connectionId })}
                    </section>
                )}

                {/* Keep the live editor mounted while reading details so its draft survives. */}
                <section className="agent-playground-conversation" hidden={showConversationDetails} aria-label={sandboxText(locale, "Agent 对话")}>
                    <div className="agent-playground-message-scroll" aria-busy={history.loading}>
                        {history.hasMore || history.error ? <div className="agent-playground-history-navigation">
                            {history.error ? <p role="alert">{history.error} <button type="button" disabled={history.loading} onClick={() => void history.refresh()}>{sandboxText(locale, '重试')}</button></p> : null}
                            {history.hasMore ? <button type="button" disabled={history.loading} onClick={() => void history.loadEarlier()}>{sandboxText(locale, '加载更早记录')}</button> : null}
                        </div> : null}
                        {channelMessages.length === 0 ? (
                            <div className="agent-playground-empty">
                                <span className="agent-playground-empty-mark"><Sparkles size={24} /></span>
                                <div><h2>{sandboxText(locale, "开始一次可观察的 Agent 运行")}</h2><p>{sandboxText(locale, "发送任务后，回复、工具调用、Token 与异常会在同一会话上下文中关联。")}</p></div>
                                <div className="agent-playground-prompts">
                                    <button type="button" onClick={() => runPrompt(sandboxText(locale, "介绍当前 Agent 可以使用的能力，并给出三个具体示例。"))}>{sandboxText(locale, "探索可用能力")}</button>
                                    <button type="button" onClick={() => runPrompt(sandboxText(locale, "用 Markdown 表格总结当前运行环境，并附上一段 TypeScript 示例代码。"))}>{sandboxText(locale, "测试富文本输出")}</button>
                                    <button type="button" onClick={() => runPrompt(sandboxText(locale, "分析一个任务从推理、工具调用到最终回复的完整执行路径。"))}>{sandboxText(locale, "观察执行路径")}</button>
                                </div>
                            </div>
                        ) : (
                            <div className="agent-playground-message-list">
                                {channelMessages.map((msg) => {
                                    if (msg.recalledMessageId) return <p key={msg.id} className="agent-playground-history-notice">{sandboxText(locale, '消息已撤回')}</p>
                                    const isApproval = msg.type === 'received' && msg.interactionReadOnly !== true && msg.content.some((segment) => segment.type === 'keyboard')
                                    return (
                                    <React.Fragment key={JSON.stringify([msg.channelType, msg.channelId, msg.type, msg.id])}>
                                    <article className={cn("agent-playground-message", msg.type === 'sent' ? "is-user" : "is-agent", isApproval && "is-approval")}>
                                        <span className="agent-playground-message-avatar">{msg.type === 'received' ? <Bot size={16} /> : <User size={16} />}</span>
                                        <div className="agent-playground-message-main">
                                            <div className="agent-playground-message-meta">
                                                <strong>{isApproval ? sandboxText(locale, "需要你的确认") : msg.type === 'received' ? endpointId : msg.senderId === connectionRef.current.ownerId ? sandboxText(locale, "你") : msg.senderName || msg.senderId}</strong>
                                                {isApproval && <span>approval required</span>}
                                                {msg.recalled && <span>{sandboxText(locale, '已撤回')}</span>}
                                                <time>{new Date(msg.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
                                            </div>
                                            <div className="agent-playground-message-content">{renderMessageSegments(msg.content, msg.type === 'sent', msg.id, msg.interactionResolved === true, undefined, msg.interactionReadOnly !== true)}</div>
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
                <section className="agent-playground-composer" hidden={showConversationDetails} aria-label={sandboxText(locale, "任务输入")}>
                    {/* Toolbar */}
                    <div className="flex gap-2 items-center flex-wrap">
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", showFacePicker ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setShowFacePicker(!showFacePicker); setMediaPanel(null) }} title={sandboxText(locale, "插入表情")}>
                            <Smile size={16} />
                        </button>
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === 'image' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setMediaPanel((p) => (p === 'image' ? null : 'image')); setShowFacePicker(false) }} title={sandboxText(locale, "插入图片 URL")}>
                            <Image size={16} />
                        </button>
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === 'video' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setMediaPanel((p) => (p === 'video' ? null : 'video')); setShowFacePicker(false) }} title={sandboxText(locale, "插入视频 URL")}>
                            <Video size={16} />
                        </button>
                        <button type="button" className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", mediaPanel === 'audio' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setMediaPanel((p) => (p === 'audio' ? null : 'audio')); setShowFacePicker(false) }} title={sandboxText(locale, "插入音频 URL")}>
                            <Music size={16} />
                        </button>
                        <div className="flex-1 min-w-[1rem]" />
                        <div className="sandbox-composer-tabs" role="tablist" aria-label={sandboxText(locale, "消息编辑模式")}>
                            <button type="button" role="tab" aria-selected={composerMode === 'write'} className={cn(composerMode === 'write' && 'active')} onClick={() => setComposerMode('write')}>{sandboxText(locale, "编写")}</button>
                            <button type="button" role="tab" aria-selected={composerMode === 'preview'} className={cn(composerMode === 'preview' && 'active')} onClick={() => setComposerMode('preview')}>{sandboxText(locale, "预览")}</button>
                        </div>
                        {inputText && (
                            <button className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-accent transition-colors"
                                onClick={() => { editorRef.current?.clear(); setInputText(''); setPreviewSegments([]); setComposerMode('write') }} aria-label={sandboxText(locale, "清空输入")}><X size={16} /></button>
                        )}
                    </div>

                    {/* Face picker */}
                    {showFacePicker && (
                        <div className="p-3 rounded-md border bg-muted/30 max-h-64 overflow-y-auto space-y-2">
                            <input value={faceSearchQuery} onChange={(e) => setFaceSearchQuery(e.target.value)}
                                placeholder={sandboxText(locale, "搜索表情...")} className="w-full h-8 rounded-md border bg-transparent px-2 text-sm" />
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
                                    <span className="text-sm text-muted-foreground">{sandboxText(locale, "未找到匹配的表情")}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {mediaPanel && (
                        <div className="p-3 rounded-md border bg-muted/30 space-y-2">
                            <p className="text-xs text-muted-foreground">
                                {mediaPanel === 'image' && sandboxText(locale, "支持 http(s) 图片链接或 data URL")}
                                {mediaPanel === 'video' && sandboxText(locale, "支持浏览器可解码的视频直链（如 .mp4、.webm）")}
                                {mediaPanel === 'audio' && sandboxText(locale, "支持 .mp3、.ogg、.wav 等音频直链")}
                            </p>
                            <input
                                value={mediaUrl}
                                onChange={(e) => setMediaUrl(e.target.value)}
                                placeholder={mediaPanel === 'image' ? sandboxText(locale, "图片 URL…") : mediaPanel === 'video' ? sandboxText(locale, "视频 URL…") : sandboxText(locale, "音频 URL…")}
                                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitMediaUrl() } }}
                            />
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                                onClick={commitMediaUrl}
                                disabled={!mediaUrl.trim()}
                            >
                                <Check size={14} /> {sandboxText(locale, "插入到输入框")}</button>
                        </div>
                    )}

                    {/* Editor + send */}
                    <div className="flex gap-2 items-start">
                        <div className="flex-1 relative">
                            <div className={composerMode === 'write' ? 'block' : 'hidden'}>
                                <RichTextEditor
                                    locale={locale}
                                    ref={editorRef} placeholder={sandboxText(locale, "向 {0} 发送消息，支持 Markdown...", [activeChannel.name])}
                                    onSend={handleSendMessage} onChange={handleEditorChange} onAtTrigger={handleAtTrigger}
                                    minHeight="44px" maxHeight="200px"
                                />
                            </div>
                            {composerMode === 'preview' && (
                                <div className="sandbox-markdown-preview" role="tabpanel">
                                    {inputText.trim()
                                        ? <MarkdownContent text={inputText} />
                                        : <span className="sandbox-markdown-preview-empty">{sandboxText(locale, "输入 Markdown 后可在这里检查最终效果")}</span>}
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
                                            <span className="text-xs text-muted-foreground">{sandboxText(locale, "未找到匹配的用户")}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <button
                            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-colors hover:bg-primary/90"
                            onClick={() => { const c = editorRef.current?.getContent(); if (c) handleSendMessage(c.text, c.segments) }}
                            disabled={!canExecute || directoryStatus.mode === 'loading' || !hasRenderableSegments(previewSegments)}>
                            <Send size={16} /> {sandboxText(locale, "发送")}</button>
                    </div>

                    {/* Hints */}
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <Info size={12} /> {sandboxText(locale, "快捷操作:")}<span className="px-1 py-0.5 rounded border text-[10px]">Enter</span> {sandboxText(locale, "发送")}<span className="px-1 py-0.5 rounded border text-[10px]">Shift+Enter</span> {sandboxText(locale, "换行")}<span className="px-1 py-0.5 rounded border text-[10px]">```ts</span> {sandboxText(locale, "代码块")}<span className="px-1 py-0.5 rounded border text-[10px]">{sandboxText(locale, "**文本**")}</span> {sandboxText(locale, "加粗")}<span className="px-1 py-0.5 rounded border text-[10px]">{sandboxText(locale, "[@名称]")}</span> {sandboxText(locale, "@某人")}<span className="px-1 py-0.5 rounded border text-[10px]">[video:URL]</span>
                        <span className="px-1 py-0.5 rounded border text-[10px]">[audio:URL]</span>
                    </div>
                </section>
            </main>

            <aside id="sandbox-run-inspector" className={cn("agent-playground-inspector", showInspector && "show")} hidden={!showInspector} aria-hidden={!showInspector} aria-label={sandboxText(locale, "运行检查器")}>
                <div className="agent-playground-inspector-head">
                    <div><span>Run inspector</span><h2>{sandboxText(locale, "运行检查器")}</h2></div>
                    <div>
                        <button type="button" onClick={() => void loadTrace()} aria-label={sandboxText(locale, "刷新 Agent Trace")} disabled={traceLoading}><RefreshCw size={15} className={cn(traceLoading && 'animate-spin')} /></button>
                        <button type="button" className="agent-playground-inspector-close" onClick={() => setShowInspector(false)} aria-label={sandboxText(locale, "关闭运行检查器")}><X size={15} /></button>
                    </div>
                </div>

                <div className="agent-playground-inspector-tabs" role="tablist" aria-label={sandboxText(locale, "检查器视图")}>
                    <button type="button" role="tab" aria-selected={inspectorView === 'runs'} className={cn(inspectorView === 'runs' && 'active')} onClick={() => setInspectorView('runs')}><Activity size={13} />{sandboxText(locale, "任务")}</button>
                    <button type="button" role="tab" aria-selected={inspectorView === 'artifacts'} className={cn(inspectorView === 'artifacts' && 'active')} onClick={() => setInspectorView('artifacts')}><FileDiff size={13} />{sandboxText(locale, "变更与产物")}<span>{workbenchArtifacts.length}</span></button>
                </div>

                <div className={cn("agent-playground-inspector-view", inspectorView !== 'runs' && 'hidden')}>

                <section className="agent-playground-inspector-section">
                    <div className="agent-playground-inspector-title"><span>{sandboxText(locale, "运行概览")}</span><small>{traceSummary.activeTurns > 0 ? 'live' : 'idle'}</small></div>
                    <div className="agent-playground-metrics">
                        <div><Activity /><strong>{traceSummary.eventCount.toLocaleString(locale)}</strong><span>{sandboxText(locale, "事件")}</span></div>
                        <div><Wrench /><strong>{traceSummary.toolCount.toLocaleString(locale)}</strong><span>{sandboxText(locale, "工具")}</span></div>
                        <div><Coins /><strong>{traceSummary.tokenCount.toLocaleString(locale)}</strong><span>Token</span></div>
                        <div className={cn(traceSummary.problemCount > 0 && 'has-problem')}><CircleAlert /><strong>{traceSummary.problemCount}</strong><span>{sandboxText(locale, "异常")}</span></div>
                    </div>
                </section>

                <section className="agent-playground-inspector-section">
                    <div className="agent-playground-inspector-title"><span>{sandboxText(locale, "上下文")}</span></div>
                    <dl className="agent-playground-context-list">
                        <div><dt>Endpoint</dt><dd>{endpointId}</dd></div>
                        <div><dt>Scope</dt><dd>{activeChannel.type}</dd></div>
                        <div><dt>Scene</dt><dd>{activeChannel.id}</dd></div>
                        <div><dt>Workdir</dt><dd title={activeChannel.runConfig.workingDirectory}>{activeChannel.runConfig.workingDirectory || 'Host project root'}</dd></div>
                        <div><dt>Security</dt><dd>{activeChannel.runConfig.safetyMode}</dd></div>
                        <div><dt>Approval</dt><dd>{activeChannel.runConfig.safetyMode === 'read-only' ? 'auto' : activeChannel.runConfig.safetyMode === 'danger-full-access' ? 'bypass' : activeChannel.runConfig.approvalMode}</dd></div>
                        <div><dt>Network</dt><dd>{activeChannel.runConfig.networkAccess ? 'enabled' : 'disabled'}</dd></div>
                        <div><dt>Isolation</dt><dd className={cn(shellIsolation?.available && 'is-online')}>{shellIsolation ? `${shellIsolation.provider}: ${shellIsolation.available ? 'ready' : 'unavailable'}` : 'checking'}</dd></div>
                        <div><dt>Transport</dt><dd className={cn(connected && 'is-online')}>{connected ? 'WebSocket online' : 'reconnecting'}</dd></div>
                    </dl>
                </section>

                <section className="agent-playground-inspector-section agent-playground-task-section">
                    <div className="agent-playground-inspector-title"><span>{sandboxText(locale, "任务历史")}</span><small>{taskRuns.length} runs</small></div>
                    {taskRuns.length > 0 ? (
                        <div className="agent-playground-task-list">
                            {taskRuns.slice(0, 8).map((run) => (
                                <article key={run.id} className={cn(`is-${run.status}`)}>
                                    <i />
                                    <div><strong>{taskStatusLabel(run.status, locale)}</strong><code>{run.turnId.slice(0, 10)}</code></div>
                                    <dl>
                                        <div><dt>{sandboxText(locale, "耗时")}</dt><dd>{run.durationMs === undefined ? sandboxText(locale, "进行中") : `${run.durationMs.toLocaleString(locale)} ms`}</dd></div>
                                        <div><dt>{sandboxText(locale, "工具")}</dt><dd>{run.toolCount}</dd></div>
                                        <div><dt>Token</dt><dd>{run.tokenCount.toLocaleString(locale)}</dd></div>
                                    </dl>
                                </article>
                            ))}
                        </div>
                    ) : <div className="agent-playground-artifact-empty"><Activity size={18} /><span>{sandboxText(locale, "运行任务后会在这里形成可回溯记录")}</span></div>}
                </section>

                <section className="agent-playground-inspector-section agent-playground-trace-section">
                    <div className="agent-playground-inspector-title"><span>{sandboxText(locale, "最近执行")}</span><small>2s sync</small></div>
                    {traceNotice && <div className="agent-playground-trace-notice" role="alert"><CircleAlert size={16} /><span>{traceNotice}</span></div>}
                    {traceLoading && !trace ? (
                        <div className="agent-playground-trace-loading"><i /><i /><i /></div>
                    ) : recentTraceEvents.length ? (
                        <div className="agent-playground-trace-list">
                            {recentTraceEvents.map((event) => {
                                const item = presentTraceEvent(event, locale)
                                return (
                                    <div key={event.sequence} className={cn("agent-playground-trace-item", `is-${item.tone}`)}>
                                        <span className="agent-playground-trace-dot" />
                                        <div><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</div>
                                        <time>{new Date(event.recordedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="agent-playground-trace-empty"><Activity size={18} /><span>{sandboxText(locale, "发送任务后显示推理与工具轨迹")}</span></div>
                    )}
                </section>
                </div>

                <div className={cn("agent-playground-inspector-view", inspectorView !== 'artifacts' && 'hidden')}>
                    <section className="agent-playground-inspector-section agent-playground-artifact-section">
                        <div className="agent-playground-inspector-title"><span>{sandboxText(locale, "文件与命令产物")}</span><small>{workbenchArtifacts.length} items</small></div>
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
                                                    {canExecute && artifact.projectFilePath && (
                                                        <a href={`/files?${new URLSearchParams({ path: artifact.projectFilePath })}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                                            <ExternalLink size={13} />{sandboxText(locale, "打开当前文件")}
                                                        </a>
                                                    )}
                                                    {artifact.diff ? <pre>{artifact.diff}</pre> : <pre>{artifact.detail || sandboxText(locale, "暂无输出")}</pre>}
                                                    <footer><span>{artifact.durationMs === undefined ? sandboxText(locale, "等待结果") : `${artifact.durationMs.toLocaleString(locale)} ms`}</span><code>{artifact.turnId.slice(0, 12)}</code></footer>
                                                </div>
                                            )}
                                        </article>
                                    )
                                })}
                            </div>
                        ) : <div className="agent-playground-artifact-empty"><FileDiff size={18} /><span>{sandboxText(locale, "Agent 修改文件、执行命令或测试后，产物会集中出现在这里")}</span></div>}
                    </section>
                </div>

                <a className="agent-playground-studio-link" href={agentSessionsPath(sessionKey)}><span><ExternalLink size={15} />{sandboxText(locale, "对话与轨迹")}</span><code>{sessionKey}</code></a>
            </aside>
            {showInspector && <div className="agent-playground-inspector-overlay" onClick={() => setShowInspector(false)} />}
        </section>
    )
}

function taskStatusLabel(status: 'running' | 'completed' | 'failed' | 'cancelled', locale: SandboxLocale = 'zh-CN'): string {
    if (status === 'running') return sandboxText(locale, "Agent 运行中")
    if (status === 'completed') return sandboxText(locale, "最近任务已完成")
    if (status === 'failed') return sandboxText(locale, "最近任务失败")
    return sandboxText(locale, "最近任务已取消")
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

function formatDuration(durationMs: number, locale: SandboxLocale = 'zh-CN'): string {
    if (durationMs < 1_000) return `${durationMs.toLocaleString(locale)} ms`
    if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`
    return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`
}

function runStepStatusLabel(status: 'running' | 'completed' | 'failed' | 'denied' | 'cancelled', locale: SandboxLocale = 'zh-CN'): string {
    if (status === 'running') return sandboxText(locale, "进行中")
    if (status === 'completed') return sandboxText(locale, "完成")
    if (status === 'denied') return sandboxText(locale, "已拒绝")
    if (status === 'cancelled') return sandboxText(locale, "已取消")
    return sandboxText(locale, "失败")
}

function safeFileName(value: string): string {
    return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48) || 'session'
}
