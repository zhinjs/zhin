import { sandboxText, type SandboxLocale } from './messages.js';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MarkdownContent,
  type MessageSegment,
} from '@zhin.js/client';
import { renderSandboxSegments, type SandboxSegmentRenderContext } from './segments/index.js';
import { buildSandboxWebSocketUrl, captureSandboxRequestContext, createSandboxMessageId, submitSandboxFrame, SANDBOX_SCOPED_PROTOCOL, type SandboxRequestContext } from './sandboxTransport.js';
import { createWorkspaceDirectoryController, type DirectoryStatus } from './workspaceDirectoryState.js';
import type { SandboxWorkspaceScope } from './workspaceDirectory.js';
import { isApprovalPrompt, readSandboxCommandHints, type SandboxCommandHints } from './composerCommands.js';
import { ensureSandboxChatIdentity, readServerSpeaker, wantsAsMe, type SandboxServerSpeaker, type SandboxSpeakerMode } from './chatIdentity.js';
import { segmentPreviewText } from './segmentFallback.js';
import {
  User, Bot, Users, Trash2, Send, Hash, MessageSquare,
  Wifi, WifiOff, Smile, Image, X, Check, Search,
  Video, Music, Plus, PanelRight, ExternalLink, RefreshCw,
  Sparkles, Activity, Wrench, Coins, CircleAlert, Gauge,
  SlidersHorizontal, FolderOpen, ShieldCheck, Network,
  Square, RotateCcw, FileDiff, Terminal, FlaskConical, ChevronDown,
  FileDown, ListChecks, MoreHorizontal, Keyboard, AtSign, Paperclip, Mic, Upload,
} from 'lucide-react';
import {
  Alert, AlertDescription, AlertTitle, Badge, Button, ConfirmDialog, DropdownMenu, DropdownMenuCheckboxItem,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, ListItemButton,
  SelectField, Switch, Tabs, TabsList, TabsTrigger, cn, usePageChrome,
} from '@zhin.js/console-ui';
import RichTextEditor, { type RichTextEditorRef } from './RichTextEditor.js';
import { sandboxStyles } from './styles.js';
import { workspaceStyles } from './workspaceStyles.js';
import ConversationRecoveryPanel from './ConversationRecoveryPanel.js';
import { useSandboxHistory } from './useSandboxHistory.js';
import { actionOutcomeFeedback, quietOutcomeNotice, readMessageOutcome } from './conversationRecovery.js';
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
  reactPlaygroundMessage,
  recallPlaygroundMessage,
  markPlaygroundActionSubmitted,
  sandboxActionSegment,
  setPlaygroundActionFeedback,
  retirePlaygroundInteractions,
  type PlaygroundMessage,
  type PlaygroundSession,
} from './playgroundState.js';
import type { SandboxAgentRunConfig } from '../../src/run-config.js';
import { SANDBOX_INBOUND_SYNTAX, expandSandboxInboundSyntax, parseSandboxInboundText } from '../../src/inbound-syntax.js';
import { createSandboxHostedMediaResolver, uploadSandboxMedia } from './sandboxMedia.js';

type Message = PlaygroundMessage
type Channel = PlaygroundSession
interface Face { id: number; emojiId: number; stickerId: number; emojiType: string; name: string; describe: string; png: boolean; apng: boolean; lottie: boolean; }

export interface SandboxPageProps {
    readonly renderConversationDetails?: (context: { readonly sessionKey: string; readonly canExecute: boolean; readonly connectionId?: string }) => React.ReactNode
}

/** ADR 0060 §5.4: the simulated role is a platform standing (群主 / 管理员 / 成员), never a zhin role. */
function platformStandingLabel(role: 'master' | 'admin' | 'member', locale: string): string {
    if (locale === 'en') return role === 'master' ? 'group owner' : role === 'admin' ? 'group admin' : 'member'
    return role === 'master' ? '群主' : role === 'admin' ? '群管理员' : '成员'
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
    // #1250 (`sandbox-typed-media-syntax-sent-as-text`): a typed media token whose link was not accepted.
    const [syntaxNotice, setSyntaxNotice] = useState<string | null>(null)
    // #1250 (`unaddressed-message-no-record`): why the last message got no reply, from its settled outcome.
    const [outcomeNotice, setOutcomeNotice] = useState<{ messageId: string; sessionKey: string; text: string } | null>(null)
    const [shellIsolation, setShellIsolation] = useState<{ available: boolean; provider: string; message: string } | null>(null)
    const [inspectorView, setInspectorView] = useState<'runs' | 'artifacts'>('runs')
    const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null)
    const [stoppingTask, setStoppingTask] = useState(false)
    const [inlineRunExpanded, setInlineRunExpanded] = useState(false)
    const [showFacePicker, setShowFacePicker] = useState(false)
    /** 输入区：插入图片 / 视频 / 音频 URL */
    const [mediaPanel, setMediaPanel] = useState<null | 'image' | 'video' | 'audio'>(null)
    const [mediaUrl, setMediaUrl] = useState('')
    // ADR 0064 D13 (I1): files being uploaded (or that failed) before they become hosted links.
    const [uploads, setUploads] = useState<Array<{ key: string; name: string; state: 'uploading' | 'failed'; message?: string }>>([])
    const [dragActive, setDragActive] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const voiceInputRef = useRef<HTMLInputElement>(null)
    const previewUrlsRef = useRef<string[]>([])
    const [atPopoverPosition, setAtPopoverPosition] = useState<{ top: number; left: number } | null>(null)
    const [atSearchQuery, setAtSearchQuery] = useState('')
    const [faceSearchQuery, setFaceSearchQuery] = useState('')
    const atSuggestions = [
        { id: 'actor-owner', name: sandboxText(locale, "当前用户") }, { id: 'actor-reviewer', name: sandboxText(locale, "审阅者") },
        { id: 'actor-operator', name: sandboxText(locale, "协作者") }, { id: endpointId, name: endpointId }
    ]
    const [previewSegments, setPreviewSegments] = useState<MessageSegment[]>([])
    const [composerMode, setComposerMode] = useState<'write' | 'preview'>('write')
    const [showChannelList, setShowChannelList] = useState(false)
    const [showInspector, setShowInspector] = useState(false)
    const [showConversationDetails, setShowConversationDetails] = useState(false)
    const [pendingRefreshEpoch, setPendingRefreshEpoch] = useState(0)
    const [showRunSettings, setShowRunSettings] = useState(false)
    const [senderId, setSenderId] = useState('dev-user')
    const [senderName, setSenderName] = useState('Developer')
    const [senderRole, setSenderRole] = useState<'master' | 'admin' | 'member'>('master')
    // ADR 0060 §5.4: what the server resolved for the last message sent (speaker, zhin role, Agent trust tier).
    const [serverRole, setServerRole] = useState<SandboxServerSpeaker | null>(null)
    // 「以我的聊天身份发言」 (default) vs a simulated sender; only a signed-in Console user can speak as themselves.
    const [speakerMode, setSpeakerMode] = useState<SandboxSpeakerMode>('me')
    const [consoleUser, setConsoleUser] = useState(false)
    const [identitySetup, setIdentitySetup] = useState<{ status: 'idle' | 'busy' | 'done' | 'unsupported' } | { status: 'failed'; message: string }>({ status: 'idle' })
    const asMe = wantsAsMe(speakerMode, consoleUser)
    const [showSenderSettings, setShowSenderSettings] = useState(false)
    /** Live binding of the current socket; drives the Host-provided quick commands. */
    const [readyConnectionId, setReadyConnectionId] = useState<string | undefined>(undefined)
    const [commandHints, setCommandHints] = useState<SandboxCommandHints | null>(null)
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

    const [inlineNotices, setInlineNotices] = useState<{ emoji: boolean; parse: boolean }>({ emoji: false, parse: false })
    const fetchFaceList = async () => {
        try {
            const res = await fetch('https://face.viki.moe/metadata.json')
            const body: unknown = res.ok ? await res.json() : undefined
            // A failed or malformed response must not break the page (the face picker just stays empty).
            if (!Array.isArray(body)) throw new Error(`unexpected face list response (${res.status})`)
            setFaceList(body as Face[])
        }
        catch (err) { console.error('[Sandbox] Failed to fetch face list:', err); setInlineNotices((n) => ({ ...n, emoji: true })) }
    }

    useEffect(() => { fetchFaceList() }, [])

    // Quick commands come from the Host's command index and the endpoint's commandPrefix;
    // without an answer the composer offers none rather than guessing.
    useEffect(() => {
        setCommandHints(null)
        if (!readyConnectionId || !canExecute) return
        const controller = new AbortController()
        void readSandboxCommandHints(readyConnectionId, { type: activeChannel.type, id: activeChannel.id }, locale, controller.signal,
            socketRequestContextRef.current ?? undefined).then((hints) => {
            if (!controller.signal.aborted) setCommandHints(hints)
        })
        return () => controller.abort()
    }, [readyConnectionId, canExecute, activeChannel.type, activeChannel.id, locale])

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
        senderName?: string; senderRole?: 'master' | 'admin' | 'member';
        senderChatRole?: string; senderTrustLevel?: string; consoleUser?: boolean;
        simulated?: boolean; displaySenderId?: string; asMeUnavailable?: string;
        revision?: number; streaming?: boolean;
        conversation?: { type: Channel['type']; id: string };
        emoji?: string; reactionId?: string; op?: string;
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
            setReadyConnectionId(data.connectionId)
            setCanExecute(data.canExecute !== false)
            setConsoleUser(data.consoleUser === true)
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
            // A failed click is reported on its card (#1250 sandbox-submitted-without-feedback).
            const source = data.messageId ? actionSourcesRef.current.get(data.messageId) : undefined
            if (source) {
                setMessages((prev) => setPlaygroundActionFeedback(prev, source.scene, source.cardId, { tone: 'error', text: notice }))
                return
            }
            setTransportNotice(notice)
            return
        }
        // ADR 0064 P1b: Endpoint control operations on an earlier message of a scene.
        if ((data.type === 'recall' || data.type === 'reaction') && data.messageId) {
            const scene = data.conversation ?? activeChannelRef.current
            const messageId = data.messageId
            if (data.type === 'recall') setMessages((prev) => recallPlaygroundMessage(prev, scene, messageId))
            else if (data.reactionId && (data.op === 'add' || data.op === 'remove')) {
                const change = { messageId, reactionId: data.reactionId, op: data.op, ...(data.emoji ? { emoji: data.emoji } : {}) } as const
                setMessages((prev) => reactPlaygroundMessage(prev, scene, change))
            }
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
        const speaker = isInput ? readServerSpeaker(data as Record<string, unknown>) : null
        if (speaker) setServerRole(speaker)
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
            channelId: sceneId, channelName, senderId: isInput ? data.displaySenderId || data.senderId || connectionRef.current.ownerId || 'owner' : 'endpoint',
            senderName: isInput ? (typeof data.senderName === 'string' && data.senderName.trim() ? data.senderName.trim() : sandboxText(locale, "当前用户")) : data.bot || endpointIdRef.current, content, timestamp: data.timestamp,
            ...(Number.isSafeInteger(data.revision) && data.revision! > 0 ? { revision: data.revision } : {}),
            ...(typeof data.streaming === 'boolean' ? { streaming: data.streaming } : {}),
        }))
    }

    /** Inputs sent by a button click → the card they came from (failure frames name the input). */
    const actionSourcesRef = useRef(new Map<string, { cardId: string; scene: Pick<Channel, 'id' | 'type'> }>())

    const sendInteractiveAction = (payload: string, messageId?: string, buttonId?: string) => {
        if (!connectionRef.current.canExecute) return false
        const scene = activeChannelRef.current
        // #1250 sandbox-action-button-id-dropped: the button's own id and its payload, like a platform callback.
        const segments: MessageSegment[] = [sandboxActionSegment(payload, buttonId)]
        const resolvedSenderId = senderId.trim() || connectionRef.current.ownerId || 'dev-user'
        const resolvedSenderName = senderName.trim() || sandboxText(localeRef.current, "测试用户")
        const actionId = createSandboxMessageId()
        const clickedAt = Date.now()
        if (!submitSandboxFrame(wsRef.current, {
            type: scene.type, id: scene.id, messageId: actionId, content: segments,
            senderId: resolvedSenderId, senderName: resolvedSenderName, senderRole, ...(asMe ? { asMe: true } : {}),
            agentRun: scene.runConfig, timestamp: clickedAt,
        })) {
            setTransportNotice(sandboxText(localeRef.current, "Sandbox 连接尚未就绪，审批选择未发送。"))
            return false
        }
        if (messageId) {
            actionSourcesRef.current.set(actionId, { cardId: messageId, scene: { id: scene.id, type: scene.type } })
            setMessages((current) => markPlaygroundActionSubmitted(current, scene, messageId, payload))
            watchActionOutcome(actionId, messageId, scene, clickedAt)
        }
        return true
    }

    /**
     * #1250 sandbox-submitted-without-feedback: 「已提交」 only means delivered. The click's outcome is
     * read a few times; a failure is shown next to the card, and so is the absence of any answer.
     */
    const watchActionOutcome = (actionId: string, cardId: string, scene: Channel, clickedAt: number) => {
        const connectionId = connectionRef.current.connectionId
        if (!connectionId) return
        const key = buildSandboxSessionKey(endpointIdRef.current, scene.type, scene.id)
        const requestContext = socketRequestContextRef.current ?? captureSandboxRequestContext()
        const delays = [3_000, 8_000, 20_000]
        const noAnswer = () => setMessages((current) => setPlaygroundActionFeedback(current, scene, cardId,
            { tone: 'quiet', text: sandboxText(localeRef.current, "没有收到机器人的处理结果") }, clickedAt))
        const attempt = (index: number) => {
            window.setTimeout(() => {
                if (connectionRef.current.connectionId !== connectionId) return
                void readMessageOutcome(connectionId, key, actionId, localeRef.current, undefined, requestContext).then((outcome) => {
                    if (outcome === undefined && index + 1 < delays.length) { attempt(index + 1); return }
                    const feedback = actionOutcomeFeedback(outcome, localeRef.current)
                    if (feedback) {
                        setMessages((current) => setPlaygroundActionFeedback(current, scene, cardId, feedback,
                            feedback.tone === 'quiet' ? clickedAt : undefined))
                    } else if (outcome == null) noAnswer()
                }).catch(() => { if (index + 1 < delays.length) attempt(index + 1); else noAnswer() })
            }, delays[index])
        }
        attempt(0)
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
                catch (err) { console.error('[Sandbox] Failed to parse message:', err); setInlineNotices((n) => ({ ...n, parse: true })) }
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

    // Same table and parser as the send path and the endpoint (src/inbound-syntax.ts).
    const parseTextToSegments = (text: string): MessageSegment[] => {
        const { segments } = parseSandboxInboundText(text)
        return segments.length > 0 ? segments as MessageSegment[] : [{ type: 'text', data: { text } }]
    }

    const hasRenderableSegments = (segments: MessageSegment[]) => {
        if (segments.length === 0) return false
        return segments.some((s) => {
            if (s.type === 'text') return Boolean(String(s.data?.text ?? '').trim())
            if (s.type === 'keyboard') return true
            return true
        })
    }

    // Hosted links of the active conversation, shown through the Console download (D12.5).
    const hostedMedia = useMemo(() => createSandboxHostedMediaResolver({
        endpointId, scene: { type: activeChannel.type, id: activeChannel.id },
        context: socketRequestContextRef.current ?? captureSandboxRequestContext(),
    }), [endpointId, activeChannel.type, activeChannel.id, connected])
    useEffect(() => () => hostedMedia.dispose(), [hostedMedia])
    useEffect(() => () => {
        for (const url of previewUrlsRef.current.splice(0)) {
            try { URL.revokeObjectURL(url) } catch { /* already revoked */ }
        }
    }, [])

    const renderMessageSegments = (
        segments: (MessageSegment | string)[],
        isSent: boolean,
        messageId?: string,
        interactionResolved = false,
        onInteractionSubmitted?: () => void,
        allowInteraction = true,
        submittedPayloads?: readonly string[],
    ): React.ReactNode[] => {
        // ADR 0064 §2: one best-effect renderer per outbound segment type (pages/index/segments/).
        const context: SandboxSegmentRenderContext = {
            locale, isSent, messageId, interactionResolved,
            canInteract: !isSent && canExecute && allowInteraction,
            submittedPayloads,
            sendAction: (payload, buttonId) => {
                const sent = sendInteractiveAction(payload, messageId, buttonId)
                if (sent) onInteractionSubmitted?.()
                return sent
            },
            renderNested: (nested) => renderSandboxSegments(nested, { ...context, canInteract: false, messageId: undefined }),
            resolveHostedMedia: hostedMedia.resolve,
        }
        return renderSandboxSegments(segments, context)
    }

    /** Reads the sent message's outcome a few times while it settles; a reply-less one gets a notice. */
    const watchQuietOutcome = (messageId: string, scene: Channel) => {
        const connectionId = connectionRef.current.connectionId
        if (!connectionId) return
        const key = buildSandboxSessionKey(endpointIdRef.current, scene.type, scene.id)
        const requestContext = socketRequestContextRef.current ?? captureSandboxRequestContext()
        const delays = [3_000, 8_000, 20_000]
        const attempt = (index: number) => {
            window.setTimeout(() => {
                if (connectionRef.current.connectionId !== connectionId) return
                void readMessageOutcome(connectionId, key, messageId, localeRef.current, undefined, requestContext).then((outcome) => {
                    if (outcome === undefined) { if (index + 1 < delays.length) attempt(index + 1); return }
                    const text = quietOutcomeNotice(outcome, localeRef.current)
                    if (text) setOutcomeNotice({ messageId, sessionKey: key, text })
                }).catch(() => { /* silent-ok: the notice is optional; the run log keeps the outcome */ })
            }, delays[index])
        }
        attempt(0)
    }

    const handleSendMessage = (_text: string, editorSegments: MessageSegment[]) => {
        // Typed `[image:URL]` etc. become the segments the buttons insert; rejected links stay text.
        const typed = expandSandboxInboundSyntax(editorSegments)
        const segments = typed.segments as MessageSegment[]
        if (!connectionRef.current.canExecute || directoryModeRef.current === 'loading' || !hasRenderableSegments(segments)) return
        const scene = activeChannelRef.current
        const resolvedSenderId = senderId.trim() || connectionRef.current.ownerId || 'dev-user'
        const resolvedSenderName = senderName.trim() || sandboxText(localeRef.current, "测试用户")
        const newMessage: Message = {
            id: createSandboxMessageId(), type: 'sent', channelType: scene.type, channelId: scene.id,
            channelName: scene.name, senderId: resolvedSenderId,
            senderName: resolvedSenderName, content: segments, timestamp: Date.now(),
        }
        if (!submitSandboxFrame(wsRef.current, {
            type: scene.type, id: scene.id, messageId: newMessage.id, content: segments,
            senderId: resolvedSenderId, senderName: resolvedSenderName, senderRole, ...(asMe ? { asMe: true } : {}),
            agentRun: scene.runConfig, timestamp: newMessage.timestamp,
        })) {
            setTransportNotice(sandboxText(localeRef.current, "Sandbox 连接尚未就绪，消息未发送。"))
            return
        }
        void directoryControllerRef.current?.save(scene, true)
        setPendingRefreshEpoch((epoch) => epoch + 1)
        setOutcomeNotice(null)
        setSyntaxNotice(typed.issues.length > 0
            ? sandboxText(localeRef.current, "{0} 不是可用的链接（只支持 http(s) 链接，图片、视频、音频也可用对应类型的 data URL），已按文本发送。", [typed.issues.map((issue) => issue.token).join(' ')])
            : null)
        watchQuietOutcome(newMessage.id, scene)
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
    /** Uploads picked / pasted / dropped files, then inserts each one's hosted link (D13.3). */
    const uploadFiles = (files: readonly File[]) => {
        setDragActive(false)
        if (!files.length) return
        const scene = { type: activeChannel.type, id: activeChannel.id }
        const context = socketRequestContextRef.current ?? captureSandboxRequestContext()
        const endpoint = endpointIdRef.current
        for (const file of files) {
            const key = createSandboxMessageId()
            const name = file.name || sandboxText(locale, "未命名文件")
            setUploads((current) => [...current, { key, name, state: 'uploading' }])
            void uploadSandboxMedia(file, { endpointId: endpoint, scene, context }).then((result) => {
                if (!result.ok) {
                    setUploads((current) => current.map((entry) => entry.key === key ? { ...entry, state: 'failed', message: result.message } : entry))
                    return
                }
                let preview: string | undefined
                if (result.reply.kind === 'image' && typeof URL.createObjectURL === 'function') {
                    preview = URL.createObjectURL(file)
                    previewUrlsRef.current.push(preview)
                }
                editorRef.current?.insertUploaded(result.segment, preview)
                setUploads((current) => current.filter((entry) => entry.key !== key))
            })
        }
    }
    const pickFiles = (input: HTMLInputElement | null) => {
        if (!input) return
        input.value = ''
        input.click()
    }
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
                        <Button type="button" size="sm" variant="destructive-outline" onClick={() => void stopActiveTask()} disabled={stoppingTask}><Square />{stoppingTask ? sandboxText(locale, "停止中") : sandboxText(locale, "停止")}</Button>
                    ) : currentTaskMessage ? (
                        <Button type="button" size="sm" variant="outline" onClick={retryCurrentTask}><RotateCcw />{sandboxText(locale, "重试")}</Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={exportCurrentRun} title={sandboxText(locale, "导出 Markdown 运行报告")}><FileDown />{sandboxText(locale, "导出")}</Button>
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
                <Button type="button" size="sm" variant="ghost" aria-expanded={inlineRunExpanded} onClick={() => setInlineRunExpanded((expanded) => !expanded)}>
                    <ChevronDown />{inlineRunExpanded ? sandboxText(locale, "收起步骤") : sandboxText(locale, "查看 {0} 个步骤", [currentRunSteps.length])}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setInspectorView(currentRunArtifacts.length > 0 ? 'artifacts' : 'runs'); setShowInspector(true) }}>
                    {currentRunArtifacts.length > 0 ? sandboxText(locale, "{0} 个变更与产物", [currentRunArtifacts.length]) : sandboxText(locale, "打开运行检查器")}<PanelRight />
                </Button>
            </footer>
        </article>
    ) : null

    const recoveryConnectionId = connectionRef.current.connectionId
    const narrowLayout = useMediaQuery(DRAWER_LAYOUT_QUERY)
    const compactRunbar = useMediaQuery(COMPACT_RUNBAR_QUERY)
    const openConversationDetails = () => setShowConversationDetails((visible) => !visible)
    const directoryLoading = directoryStatus.mode === 'loading'
    // ADR 0063 决策 2 / D18: the page header belongs to the Console shell. The two pane toggles the narrow
    // layout needs go to the shell's header actions; without a shell the page draws them itself.
    const chromeActions = useMemo(() => (
        <>
            {narrowLayout && (
                <Button type="button" variant="outline" aria-expanded={showChannelList} onClick={() => setShowChannelList((visible) => !visible)}>
                    <MessageSquare />{sandboxText(locale, "会话列表")}
                </Button>
            )}
            <Button type="button" variant="outline" aria-expanded={showInspector} aria-controls="sandbox-run-inspector" onClick={() => setShowInspector((visible) => !visible)}>
                <PanelRight />{sandboxText(locale, "检查器")}
            </Button>
        </>
    ), [locale, narrowLayout, showChannelList, showInspector])
    const hosted = usePageChrome({ actions: chromeActions })
    const connectionBadge = (
        <span className={cn("agent-playground-connection", connected && "is-online")} role="img"
            aria-label={connected ? sandboxText(locale, "Sandbox WebSocket 已连接") : sandboxText(locale, "正在重连 Sandbox WebSocket")}
            title={connected ? sandboxText(locale, "Sandbox WebSocket 已连接") : sandboxText(locale, "正在重连 Sandbox WebSocket")}>
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
        </span>
    )
    const notice = (key: string, options: { title?: string; message: React.ReactNode; tone?: 'default' | 'destructive'; role?: 'alert' | 'status'; action: React.ReactNode }) => (
        <Alert key={key} variant={options.tone ?? 'default'} role={options.role ?? 'status'} className="sandbox-alert">
            <div className="sandbox-alert-copy">
                {options.title && <AlertTitle>{options.title}</AlertTitle>}
                <AlertDescription>{options.message}</AlertDescription>
            </div>
            {options.action}
        </Alert>
    )
    return (
        <section className={cn("zhin-sandbox agent-playground-shell", showInspector && "has-inspector", hosted && "is-hosted")}>
            <style>{`${workspaceStyles}
${sandboxStyles}`}</style>
            {!hosted && (
                <div className="agent-playground-mobilebar">
                    {chromeActions}
                </div>
            )}

            <nav className={cn("channel-sidebar agent-playground-sessions", showChannelList && "show")} aria-label={sandboxText(locale, "会话列表")}>
                {!hosted && (
                    <div className="agent-playground-brand">
                        <div>
                            <div>
                                <span className="agent-playground-mark"><Sparkles size={16} /></span>
                                <div><h2>{sandboxText(locale, "会话")}</h2></div>
                            </div>
                            {connectionBadge}
                        </div>
                    </div>
                )}

                <div className="agent-playground-section-label">
                    <span>{sandboxText(locale, "会话列表")}</span><span>{channels.length}</span>
                    {hosted && connectionBadge}
                    <Button type="button" variant="ghost" size="icon" disabled={directoryLoading} aria-label={sandboxText(locale, "刷新会话目录")} title={sandboxText(locale, "刷新会话目录")} onClick={() => void directoryControllerRef.current?.refresh()}><RefreshCw /></Button>
                </div>
                <div className="agent-playground-session-list">
                    {channels.map((channel) => {
                        const isActive = activeChannel.id === channel.id && activeChannel.type === channel.type
                        return (
                            <ListItemButton key={`${channel.type}:${channel.id}`} disabled={directoryLoading} aria-current={isActive ? 'page' : undefined} className={cn("agent-playground-session", isActive && "active")} onClick={() => switchChannel(channel)}>
                                <span className="agent-playground-session-icon">{getChannelIcon(channel.type)}</span>
                                <div className="agent-playground-session-copy">
                                    <div className="agent-playground-session-title">{channel.name}</div>
                                    <div className="agent-playground-session-scope">{channel.type === 'private' ? sandboxText(locale, "单用户作用域") : channel.type === 'group' ? sandboxText(locale, "群组作用域") : sandboxText(locale, "频道作用域")}</div>
                                </div>
                                {channel.unread > 0 && <span className="agent-playground-unread">{channel.unread}</span>}
                            </ListItemButton>
                        )
                    })}
                </div>

                <div className="agent-playground-new-session">
                    {showNewSession ? (
                        <div className="agent-playground-new-form">
                            <Input value={newSessionName} onChange={(event) => setNewSessionName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addSession() }} placeholder={sandboxText(locale, "会话名称")} aria-label={sandboxText(locale, "会话名称")} autoFocus />
                            <div className="agent-playground-scope-picker" role="group" aria-label={sandboxText(locale, "消息作用域")}>
                                {(['private', 'group', 'channel'] as SandboxScope[]).map((scope) => (
                                    <ListItemButton key={scope} aria-pressed={newSessionScope === scope} className={cn(newSessionScope === scope && 'active')} onClick={() => setNewSessionScope(scope)}>
                                        {scope === 'private' ? sandboxText(locale, "单用户") : scope === 'group' ? sandboxText(locale, "群组") : sandboxText(locale, "频道")}
                                    </ListItemButton>
                                ))}
                            </div>
                            <div className="agent-playground-new-actions">
                                <Button type="button" variant="outline" onClick={() => setShowNewSession(false)}>{sandboxText(locale, "取消")}</Button>
                                <Button type="button" onClick={addSession}>{sandboxText(locale, "创建")}</Button>
                            </div>
                        </div>
                    ) : (
                        <Button type="button" variant="outline" disabled={directoryLoading} className="sandbox-block-button" onClick={() => setShowNewSession(true)}><Plus />{sandboxText(locale, "新建会话")}</Button>
                    )}
                </div>
                <div className="agent-playground-endpoint">
                    <span>{directoryLoading ? sandboxText(locale, "正在读取会话目录") : directoryStatus.mode === 'server' && !directoryStatus.error ? sandboxText(locale, "Host 会话目录") : persistenceStatus === 'saved' ? sandboxText(locale, "会话已持久化") : sandboxText(locale, "会话保存失败")}</span>
                    <strong>{endpointId}</strong>
                </div>
            </nav>

            {showChannelList && <div className="channel-overlay" onClick={() => setShowChannelList(false)} />}

            <main className="chat-area agent-playground-main">
                <header className="agent-playground-runbar">
                    <div className="agent-playground-run-identity">
                        <span className="agent-playground-run-icon">{getChannelIcon(activeChannel.type)}</span>
                        <div title={sessionKey}>
                            <div className="agent-playground-run-title"><h2 title={activeChannel.name}>{activeChannel.name}</h2><span>{scopeLabel}</span></div>
                        </div>
                    </div>
                    <div className="agent-playground-run-actions">
                        <span className={cn("agent-playground-run-state", currentTask?.status === 'running' && "is-running", currentTask?.status === 'failed' && 'has-problem')}>
                            {currentTask?.status === 'running' ? <Activity size={14} /> : <Gauge size={14} />}
                            {currentTask ? taskStatusLabel(currentTask.status, locale) : sandboxText(locale, "{0} 条消息", [channelMessages.length])}
                        </span>
                        {currentTask?.status === 'running' ? (
                            <Button type="button" size="sm" variant="destructive-outline" onClick={() => void stopActiveTask()} disabled={stoppingTask} aria-label={sandboxText(locale, "停止当前任务")}><Square />{stoppingTask ? sandboxText(locale, "停止中") : sandboxText(locale, "停止")}</Button>
                        ) : lastUserMessage && !compactRunbar ? (
                            <Button type="button" size="sm" variant="outline" onClick={retryLastTask} aria-label={sandboxText(locale, "重新运行上一个任务")}><RotateCcw />{sandboxText(locale, "重试")}</Button>
                        ) : null}
                        {compactRunbar ? null : props.renderConversationDetails
                            ? <Button type="button" size="sm" variant="outline" disabled={!canExecute} aria-expanded={showConversationDetails} aria-controls="sandbox-conversation-details" onClick={openConversationDetails}><ListChecks />{sandboxText(locale, "对话与轨迹")}</Button>
                            : <Button asChild size="sm" variant="outline"><a href={agentSessionsPath(sessionKey)}><ExternalLink />{sandboxText(locale, "对话与轨迹")}</a></Button>}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className={cn((showSenderSettings || showRunSettings) && 'is-active')}
                                    aria-label={sandboxText(locale, "更多操作")}
                                    title={sandboxText(locale, "更多操作")}
                                >
                                    <MoreHorizontal />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {compactRunbar && currentTask?.status !== 'running' && lastUserMessage && (
                                    <DropdownMenuItem onSelect={retryLastTask}><RotateCcw />{sandboxText(locale, "重试")}</DropdownMenuItem>
                                )}
                                {compactRunbar && (props.renderConversationDetails
                                    ? <DropdownMenuItem disabled={!canExecute} onSelect={openConversationDetails}><ListChecks />{sandboxText(locale, "对话与轨迹")}</DropdownMenuItem>
                                    : <DropdownMenuItem asChild><a href={agentSessionsPath(sessionKey)}><ExternalLink />{sandboxText(locale, "对话与轨迹")}</a></DropdownMenuItem>)}
                                {compactRunbar && <DropdownMenuSeparator />}
                                <DropdownMenuCheckboxItem checked={showSenderSettings} onCheckedChange={(checked) => setShowSenderSettings(checked === true)}>
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span>{sandboxText(locale, "模拟发送者")}</span>
                                        <Badge variant="secondary" size="sm" title={locale === 'en' ? 'Simulated platform standing (not a zhin role)' : '模拟的平台身份（不是 zhin 角色）'}>{asMe ? sandboxText(locale, "我的聊天身份") : (senderName.trim() || senderId.trim() || 'dev-user')} · {platformStandingLabel(senderRole, locale)}</Badge>
                                        {serverRole && (serverRole.simulated
                                            ? <Badge variant="secondary" size="sm" title={sandboxText(locale, "客户端自填的发送者不解析 zhin 角色")}>{sandboxText(locale, "模拟身份，无角色")}</Badge>
                                            : <Badge variant="secondary" size="sm" title={locale === 'en' ? 'Resolved by the server: zhin role · Agent trust tier' : '服务端解析：zhin 角色 · Agent 信任档位'}>
                                                {`zhin: ${serverRole.chatRole ?? (locale === 'en' ? 'none' : '无')} · ${serverRole.trustLevel}`}
                                            </Badge>)}
                                    </span>
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuCheckboxItem checked={showRunSettings} onCheckedChange={(checked) => setShowRunSettings(checked === true)}>
                                    {sandboxText(locale, "配置运行环境")}
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuCheckboxItem checked={showInspector} aria-controls="sandbox-run-inspector" onCheckedChange={(checked) => setShowInspector(checked === true)}>
                                    {sandboxText(locale, "切换运行检查器")}
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmClear(true)}>
                                    <Trash2 />{sandboxText(locale, "清空当前会话")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </header>

                {showSenderSettings && (
                    <section className="agent-playground-run-settings sandbox-sender-settings" aria-label={locale === 'en' ? 'Simulated sender' : '模拟发送者配置'}>
                        <div className="sandbox-speaker-mode">
                            <label className="sandbox-speaker-toggle">
                                <Switch checked={speakerMode === 'me'} disabled={!consoleUser}
                                    onCheckedChange={(checked) => setSpeakerMode(checked ? 'me' : 'simulated')} />
                                <span>{sandboxText(locale, "以我的聊天身份发言")}</span>
                            </label>
                            <p>
                                {!consoleUser
                                    ? sandboxText(locale, "当前连接没有 Console 用户（未登录或 --standalone），所有消息都按模拟身份处理，不解析 zhin 角色。")
                                    : asMe
                                    ? sandboxText(locale, "以链接到你 Console 账号的聊天身份发言，角色按你的聊天角色解析。")
                                    : sandboxText(locale, "模拟身份，无角色：自填的发送者 ID 只用于模拟别人，不解析 zhin 角色。")}
                            </p>
                            {asMe && serverRole?.asMeUnavailable === 'needs-global-iam' && (
                                <div className="sandbox-speaker-setup" role="status">
                                    <span>{sandboxText(locale, "链接到你的聊天身份持有全局角色，以它发言需要全局 iam.manage 权限；上一条消息按模拟身份（无角色）发送。")}</span>
                                </div>
                            )}
                            {asMe && serverRole?.asMeUnavailable === 'no-identity' && (
                                <div className="sandbox-speaker-setup" role="status">
                                    <span>{sandboxText(locale, "你在 Sandbox 上还没有聊天身份，上一条消息按模拟身份发送。")}</span>
                                    <Button type="button" size="sm" variant="outline" disabled={identitySetup.status === 'busy'} onClick={() => {
                                        setIdentitySetup({ status: 'busy' })
                                        void ensureSandboxChatIdentity(socketRequestContextRef.current ?? undefined).then((result) => {
                                            setIdentitySetup(result.status === 'ok' ? { status: 'done' } : result)
                                        })
                                    }}>{sandboxText(locale, "在 Sandbox 上创建我的聊天身份")}</Button>
                                    {identitySetup.status === 'done' && <em>{sandboxText(locale, "已创建，下一条消息生效。")}</em>}
                                    {identitySetup.status === 'unsupported' && <em>{sandboxText(locale, "当前 Host 不支持，请升级。")}</em>}
                                    {identitySetup.status === 'failed' && <em>{identitySetup.message}</em>}
                                </div>
                            )}
                        </div>
                        <label>
                            <span><User size={14} />{locale === 'en' ? 'Sender ID (simulated, no role)' : '发送者 ID（模拟身份，无角色）'}</span>
                            <Input
                                value={senderId}
                                disabled={asMe}
                                onChange={(event) => setSenderId(event.target.value)}
                                placeholder="dev-user"
                                spellCheck={false}
                            />
                        </label>
                        <label>
                            <span>{locale === 'en' ? 'Sender Name' : '发送者昵称'}</span>
                            <Input
                                value={senderName}
                                disabled={asMe}
                                onChange={(event) => setSenderName(event.target.value)}
                                placeholder="Developer"
                                spellCheck={false}
                            />
                        </label>
                        <div className="sandbox-field">
                            <span><ShieldCheck size={14} />{locale === 'en' ? 'Platform standing (not a zhin role)' : '平台身份（不是 zhin 角色）'}</span>
                            <div className="sandbox-role-switcher" role="group" aria-label={locale === 'en' ? 'Platform standing' : '平台身份'}>
                                {(['member', 'admin', 'master'] as const).map((role) => (
                                    <ListItemButton
                                        key={role}
                                        aria-pressed={senderRole === role}
                                        className={cn("sandbox-role-option", `is-${role}`, senderRole === role && "active")}
                                        onClick={() => setSenderRole(role)}
                                    >
                                        {platformStandingLabel(role, locale)}
                                    </ListItemButton>
                                ))}
                            </div>
                        </div>
                        <div className="sandbox-sender-presets">
                            <Button type="button" size="sm" variant="outline" onClick={() => { setSenderId('dev-user'); setSenderName('Developer'); setSenderRole('master') }}>{locale === 'en' ? 'Group owner (platform standing, dev-user)' : '群主（平台身份，dev-user）'}</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => { setSenderId('admin-user'); setSenderName('Admin'); setSenderRole('admin') }}>Admin (admin-user)</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => { setSenderId('member-user'); setSenderName('Member'); setSenderRole('member') }}>Member (member-user)</Button>
                        </div>
                    </section>
                )}

                {cancellationFeedback && notice('cancellation', {
                    message: cancellationFeedback.message,
                    tone: cancellationFeedback.kind === 'error' ? 'destructive' : 'default',
                    role: cancellationFeedback.kind === 'error' ? 'alert' : 'status',
                    action: <Button type="button" size="sm" variant="outline" onClick={() => setCancellationFeedback(null)}>{sandboxText(locale, "知道了")}</Button>,
                })}

                <ConfirmDialog
                    open={confirmClear}
                    onOpenChange={setConfirmClear}
                    title={sandboxText(locale, "清空当前测试记录？")}
                    description={`${sandboxText(locale, "只移除“")}${activeChannel.name}${sandboxText(locale, "”在浏览器中的消息，不影响 Agent 会话存储。")}`}
                    confirmLabel={sandboxText(locale, "确认清空")}
                    cancelLabel={sandboxText(locale, "取消")}
                    variant="destructive"
                    onConfirm={clearMessages}
                />

                {(['emoji', 'parse'] as const).filter((kind) => inlineNotices[kind]).map((kind) => notice(kind, {
                    message: kind === 'emoji' ? sandboxText(locale, "表情列表加载失败，表情选择器暂不可用。") : sandboxText(locale, "收到一条无法解析的消息，已忽略。"),
                    action: <Button type="button" size="sm" variant="outline" onClick={() => setInlineNotices((n) => ({ ...n, [kind]: false }))}>{sandboxText(locale, "知道了")}</Button>,
                }))}

                {outcomeNotice && outcomeNotice.sessionKey === sessionKey && notice('outcome', {
                    title: sandboxText(locale, "这条消息没有回复"),
                    message: outcomeNotice.text,
                    role: 'status',
                    action: <Button type="button" size="sm" variant="outline" onClick={() => setOutcomeNotice(null)}>{sandboxText(locale, "知道了")}</Button>,
                })}

                {syntaxNotice && notice('syntax', {
                    title: sandboxText(locale, "有写法没有生效"),
                    message: syntaxNotice,
                    role: 'status',
                    action: <Button type="button" size="sm" variant="outline" onClick={() => setSyntaxNotice(null)}>{sandboxText(locale, "知道了")}</Button>,
                })}

                {transportNotice && notice('transport', {
                    title: sandboxText(locale, "运行暂不可用"),
                    message: transportNotice,
                    action: <Button type="button" size="sm" variant="outline" onClick={() => setTransportNotice(null)}>{sandboxText(locale, "知道了")}</Button>,
                })}

                {directoryStatus.error && notice('directory', {
                    title: sandboxText(locale, "会话目录"),
                    message: directoryStatus.error,
                    tone: 'destructive',
                    role: 'alert',
                    action: <Button type="button" size="sm" variant="outline" onClick={() => void directoryControllerRef.current?.refresh()}>{sandboxText(locale, "重新读取")}</Button>,
                })}

                {showRunSettings && (
                    <section className="agent-playground-run-settings" aria-label={sandboxText(locale, "运行配置")}>
                        <label className="agent-playground-directory-field">
                            <span><FolderOpen size={14} />{sandboxText(locale, "工作目录")}</span>
                            <Input
                                disabled={directoryLoading}
                                value={activeChannel.runConfig.workingDirectory}
                                onChange={(event) => updateRunConfig({ workingDirectory: event.target.value })}
                                placeholder={sandboxText(locale, "使用 Host 项目目录")}
                                spellCheck={false}
                            />
                        </label>
                        <div className="sandbox-field">
                            <span><ShieldCheck size={14} />{sandboxText(locale, "安全策略")}</span>
                            <SelectField
                                aria-label={sandboxText(locale, "安全策略")}
                                disabled={directoryLoading}
                                value={activeChannel.runConfig.safetyMode}
                                options={[
                                    { value: 'read-only', label: sandboxText(locale, "只读") },
                                    { value: 'workspace-write', label: sandboxText(locale, "工作区写入") },
                                    { value: 'danger-full-access', label: sandboxText(locale, "完全访问") },
                                ]}
                                onValueChange={(value) => {
                                    const safetyMode = value as SandboxAgentRunConfig['safetyMode']
                                    updateRunConfig({ safetyMode, ...(safetyMode === 'danger-full-access' ? { networkAccess: true } : {}) })
                                }}
                            />
                        </div>
                        <div className="sandbox-field">
                            <span>{sandboxText(locale, "审批策略")}</span>
                            <SelectField
                                aria-label={sandboxText(locale, "审批策略")}
                                value={activeChannel.runConfig.safetyMode === 'read-only' ? 'auto' : activeChannel.runConfig.safetyMode === 'danger-full-access' ? 'bypass' : activeChannel.runConfig.approvalMode}
                                disabled={activeChannel.runConfig.safetyMode !== 'workspace-write'}
                                options={[
                                    { value: 'ask', label: sandboxText(locale, "按需确认") },
                                    { value: 'auto', label: sandboxText(locale, "审核 Agent 自动判断") },
                                    { value: 'bypass', label: sandboxText(locale, "绕过审批") },
                                ]}
                                onValueChange={(value) => updateRunConfig({ approvalMode: value as SandboxAgentRunConfig['approvalMode'] })}
                            />
                        </div>
                        <label className="agent-playground-network-toggle">
                            <span><Network size={14} />{sandboxText(locale, "网络访问")}</span>
                            <Switch
                                checked={activeChannel.runConfig.safetyMode === 'danger-full-access' || activeChannel.runConfig.networkAccess}
                                disabled={activeChannel.runConfig.safetyMode === 'danger-full-access'}
                                onCheckedChange={(checked) => updateRunConfig({ networkAccess: checked })}
                            />
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
                        <Button type="button" size="sm" variant="ghost" className="sandbox-details-back" onClick={() => setShowConversationDetails(false)}><MessageSquare />{sandboxText(locale, "返回会话")}</Button>
                        {props.renderConversationDetails({ sessionKey, canExecute, connectionId: connectionRef.current.connectionId })}
                    </section>
                )}

                {/* Keep the live editor mounted while reading details so its draft survives. */}
                <section className="agent-playground-conversation" hidden={showConversationDetails} aria-label={sandboxText(locale, "Agent 对话")}>
                    <div className="agent-playground-message-scroll" aria-busy={history.loading}>
                        {history.hasMore || history.error ? <div className="agent-playground-history-navigation">
                            {history.error ? <p role="alert">{history.error} <Button type="button" size="sm" variant="outline" disabled={history.loading} onClick={() => void history.refresh()}>{sandboxText(locale, '重试')}</Button></p> : null}
                            {history.hasMore ? <Button type="button" size="sm" variant="outline" disabled={history.loading} onClick={() => void history.loadEarlier()}>{sandboxText(locale, '加载更早记录')}</Button> : null}
                        </div> : null}
                        {channelMessages.length === 0 && history.loading ? (
                            // Same full-height box as the empty state, so loaded history does not move the composer under the cursor.
                            <div className="agent-playground-empty" role="status">
                                <p>{sandboxText(locale, "正在加载会话记录…")}</p>
                            </div>
                        ) : channelMessages.length === 0 ? (
                            <div className="agent-playground-empty">
                                <span className="agent-playground-empty-mark"><Sparkles size={24} /></span>
                                <div><h2>{sandboxText(locale, "开始一次可观察的 Agent 运行")}</h2><p>{sandboxText(locale, "发送任务后，回复、工具调用、Token 与异常会在同一会话上下文中关联。")}</p></div>
                                <div className="agent-playground-prompts">
                                    <ListItemButton onClick={() => runPrompt(sandboxText(locale, "介绍当前 Agent 可以使用的能力，并给出三个具体示例。"))}>{sandboxText(locale, "探索可用能力")}</ListItemButton>
                                    <ListItemButton onClick={() => runPrompt(sandboxText(locale, "用 Markdown 表格总结当前运行环境，并附上一段 TypeScript 示例代码。"))}>{sandboxText(locale, "测试富文本输出")}</ListItemButton>
                                    <ListItemButton onClick={() => runPrompt(sandboxText(locale, "分析一个任务从推理、工具调用到最终回复的完整执行路径。"))}>{sandboxText(locale, "观察执行路径")}</ListItemButton>
                                </div>
                            </div>
                        ) : (
                            <div className="agent-playground-message-list">
                                {channelMessages.map((msg) => {
                                    if (msg.recalledMessageId) return <p key={msg.id} className="agent-playground-history-notice">{sandboxText(locale, '消息已撤回')}</p>
                                    const isApproval = isApprovalPrompt(msg)
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
                                            <div className="agent-playground-message-content">{renderMessageSegments(msg.content, msg.type === 'sent', msg.id, msg.interactionResolved === true, undefined, msg.interactionReadOnly !== true, msg.submittedActions)}</div>
                                            {msg.actionFeedback && (
                                                <p className={cn("sandbox-action-feedback", `is-${msg.actionFeedback.tone}`)} role={msg.actionFeedback.tone === 'error' ? 'alert' : 'status'}>
                                                    <CircleAlert size={14} aria-hidden="true" />{msg.actionFeedback.text}
                                                </p>
                                            )}
                                            {msg.reactions && msg.reactions.length > 0 && (
                                                <div className="sandbox-reactions" aria-label={sandboxText(locale, "表情回应")}>
                                                    {msg.reactions.map((reaction) => <span key={reaction.id} className="sandbox-reaction">{reaction.emoji}</span>)}
                                                </div>
                                            )}
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
                    <div className="sandbox-toolbar">
                        <Button type="button" variant={showFacePicker ? 'secondary' : 'ghost'} size="icon" aria-pressed={showFacePicker}
                            onClick={() => { setShowFacePicker(!showFacePicker); setMediaPanel(null) }} aria-label={sandboxText(locale, "插入表情")} title={sandboxText(locale, "插入表情")}>
                            <Smile />
                        </Button>
                        <Button type="button" variant={mediaPanel === 'image' ? 'secondary' : 'ghost'} size="icon" aria-pressed={mediaPanel === 'image'}
                            onClick={() => { setMediaPanel((p) => (p === 'image' ? null : 'image')); setShowFacePicker(false) }} aria-label={sandboxText(locale, "插入图片 URL")} title={sandboxText(locale, "插入图片 URL")}>
                            <Image />
                        </Button>
                        <Button type="button" variant={mediaPanel === 'video' ? 'secondary' : 'ghost'} size="icon" aria-pressed={mediaPanel === 'video'}
                            onClick={() => { setMediaPanel((p) => (p === 'video' ? null : 'video')); setShowFacePicker(false) }} aria-label={sandboxText(locale, "插入视频 URL")} title={sandboxText(locale, "插入视频 URL")}>
                            <Video />
                        </Button>
                        <Button type="button" variant={mediaPanel === 'audio' ? 'secondary' : 'ghost'} size="icon" aria-pressed={mediaPanel === 'audio'}
                            onClick={() => { setMediaPanel((p) => (p === 'audio' ? null : 'audio')); setShowFacePicker(false) }} aria-label={sandboxText(locale, "插入音频 URL")} title={sandboxText(locale, "插入音频 URL")}>
                            <Music />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" disabled={!canExecute}
                            onClick={() => { setShowFacePicker(false); setMediaPanel(null); pickFiles(fileInputRef.current) }}
                            aria-label={sandboxText(locale, "上传文件")} title={sandboxText(locale, "上传文件（图片、语音、任意文件；也可拖放或粘贴）")}>
                            <Paperclip />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" disabled={!canExecute}
                            onClick={() => { setShowFacePicker(false); setMediaPanel(null); pickFiles(voiceInputRef.current) }}
                            aria-label={sandboxText(locale, "上传语音")} title={sandboxText(locale, "上传语音（本地音频文件）")}>
                            <Mic />
                        </Button>
                        <Input ref={fileInputRef} type="file" multiple hidden className="sandbox-file-input" tabIndex={-1} aria-hidden="true" data-testid="sandbox-file-input"
                            onChange={(event) => uploadFiles(Array.from(event.currentTarget.files ?? []))} />
                        <Input ref={voiceInputRef} type="file" accept="audio/*" hidden className="sandbox-file-input" tabIndex={-1} aria-hidden="true" data-testid="sandbox-voice-input"
                            onChange={(event) => uploadFiles(Array.from(event.currentTarget.files ?? []))} />
                        <Button type="button" variant="ghost" size="icon"
                            onClick={() => { editorRef.current?.insertAt(endpointId, endpointId); setShowFacePicker(false); setMediaPanel(null) }}
                            title={sandboxText(locale, "@ 机器人（插入 [@{0}]）", [endpointId])} aria-label={sandboxText(locale, "@ 机器人")}>
                            <AtSign />
                        </Button>
                        <div className="sandbox-quick-commands" role="toolbar" aria-label={locale === 'en' ? 'Quick commands' : '快捷命令'}>
                            {(commandHints?.quick ?? []).map((cmd) => (
                                <ListItemButton
                                    key={cmd}
                                    className="sandbox-command-chip"
                                    disabled={!canExecute || directoryLoading}
                                    // Keyboard-reachable (WCAG 2.1.1). A mouse click must not keep focus on the chip,
                                    // and the prefill moves focus into the composer, so Enter sends the draft
                                    // rather than re-activating the chip after a late layout shift (#1250).
                                    onMouseDown={(event) => event.preventDefault()}
                                    // Pre-fill the composer (never overwriting a draft); sending stays an explicit Enter / Send.
                                    onClick={() => editorRef.current?.setText(cmd)}
                                >
                                    <Terminal size={11} />
                                    <span>{cmd}</span>
                                </ListItemButton>
                            ))}
                            <ListItemButton
                                className="sandbox-command-chip is-clear"
                                disabled={channelMessages.length === 0}
                                onClick={clearMessages}
                                title={sandboxText(locale, "清空当前会话")}
                            >
                                <Trash2 size={11} />
                                <span>{locale === 'en' ? 'Clear' : '清屏'}</span>
                            </ListItemButton>
                        </div>
                        <div className="sandbox-toolbar-spacer" />
                        <Tabs value={composerMode} onValueChange={(value) => setComposerMode(value === 'preview' ? 'preview' : 'write')}>
                            <TabsList aria-label={sandboxText(locale, "消息编辑模式")}>
                                <TabsTrigger value="write">{sandboxText(locale, "编写")}</TabsTrigger>
                                <TabsTrigger value="preview">{sandboxText(locale, "预览")}</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {inputText && (
                            <Button type="button" variant="ghost" size="icon"
                                onClick={() => { editorRef.current?.clear(); setInputText(''); setPreviewSegments([]); setComposerMode('write') }} aria-label={sandboxText(locale, "清空输入")} title={sandboxText(locale, "清空输入")}><X /></Button>
                        )}
                    </div>

                    {/* Face picker */}
                    {showFacePicker && (
                        <div className="sandbox-panel">
                            <Input value={faceSearchQuery} onChange={(e) => setFaceSearchQuery(e.target.value)}
                                placeholder={sandboxText(locale, "搜索表情...")} aria-label={sandboxText(locale, "搜索表情...")} />
                            <div className="sandbox-face-grid">
                                {filteredFaces.slice(0, 80).map((face) => (
                                    <ListItemButton key={face.id} onClick={() => insertFace(face.id)} title={face.name} aria-label={face.name}
                                        className="sandbox-face-button">
                                        <img src={`https://face.viki.moe/apng/${face.id}.png`} alt="" className="sandbox-face-img" />
                                    </ListItemButton>
                                ))}
                            </div>
                            {filteredFaces.length === 0 && (
                                <div className="sandbox-empty-hint">
                                    <Search size={28} />
                                    <span>{sandboxText(locale, "未找到匹配的表情")}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {mediaPanel && (
                        <div className="sandbox-panel">
                            <p className="sandbox-panel-hint">
                                {mediaPanel === 'image' && sandboxText(locale, "支持 http(s) 图片链接或 data URL")}
                                {mediaPanel === 'video' && sandboxText(locale, "支持浏览器可解码的视频直链（如 .mp4、.webm）")}
                                {mediaPanel === 'audio' && sandboxText(locale, "支持 .mp3、.ogg、.wav 等音频直链")}
                            </p>
                            <Input
                                value={mediaUrl}
                                onChange={(e) => setMediaUrl(e.target.value)}
                                placeholder={mediaPanel === 'image' ? sandboxText(locale, "图片 URL…") : mediaPanel === 'video' ? sandboxText(locale, "视频 URL…") : sandboxText(locale, "音频 URL…")}
                                aria-label={mediaPanel === 'image' ? sandboxText(locale, "图片 URL…") : mediaPanel === 'video' ? sandboxText(locale, "视频 URL…") : sandboxText(locale, "音频 URL…")}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitMediaUrl() } }}
                            />
                            <Button
                                type="button"
                                onClick={commitMediaUrl}
                                disabled={!mediaUrl.trim()}
                            >
                                <Check />{sandboxText(locale, "插入到输入框")}</Button>
                        </div>
                    )}

                    {uploads.length > 0 && (
                        <ul className="sandbox-upload-list" aria-label={sandboxText(locale, "上传")}>
                            {uploads.map((entry) => (
                                <li key={entry.key} className={cn("sandbox-upload-item", entry.state === 'failed' && "is-failed")}
                                    role={entry.state === 'failed' ? 'alert' : 'status'}>
                                    {entry.state === 'failed' ? <CircleAlert size={14} aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
                                    <span className="sandbox-upload-name">{entry.name}</span>
                                    <span className="sandbox-upload-state">{entry.state === 'failed'
                                        ? sandboxText(locale, "上传失败：{0}", [entry.message ?? ''])
                                        : sandboxText(locale, "正在上传…")}</span>
                                    {entry.state === 'failed' && (
                                        <Button type="button" variant="ghost" size="icon" aria-label={sandboxText(locale, "关闭")}
                                            onClick={() => setUploads((current) => current.filter((item) => item.key !== entry.key))}><X /></Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Editor + send */}
                    <div className="sandbox-editor-row">
                        <div className={cn("sandbox-editor-wrap", dragActive && "is-drag-active")}
                            onDragEnter={(event) => { if (canExecute && Array.from(event.dataTransfer.types ?? []).includes('Files')) setDragActive(true) }}
                            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}>
                            <div hidden={composerMode !== 'write'}>
                                <RichTextEditor
                                    locale={locale}
                                    ref={editorRef} placeholder={sandboxText(locale, "向 {0} 发送消息，支持 Markdown...", [activeChannel.name])}
                                    onSend={handleSendMessage} onChange={handleEditorChange} onAtTrigger={handleAtTrigger}
                                    onFiles={canExecute ? uploadFiles : undefined}
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
                                <div className="sandbox-at-popover" role="listbox" aria-label={sandboxText(locale, "@ 机器人")}
                                    style={{ top: `${atPopoverPosition.top}px`, left: `${atPopoverPosition.left}px` }}>
                                    {filteredAtSuggestions.length > 0 ? filteredAtSuggestions.map((user) => (
                                        <ListItemButton key={user.id} role="option" aria-selected={false} className="sandbox-at-item"
                                            onMouseDown={(event) => event.preventDefault()} onClick={() => selectAtUser(user)}>
                                            <User size={16} />
                                            <span><span className="sandbox-at-name">{user.name}</span><span className="sandbox-at-id">ID: {user.id}</span></span>
                                        </ListItemButton>
                                    )) : (
                                        <div className="sandbox-empty-hint">
                                            <Search size={20} />
                                            <span>{sandboxText(locale, "未找到匹配的用户")}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <Button
                            type="button"
                            onClick={() => { const c = editorRef.current?.getContent(); if (c) handleSendMessage(c.text, c.segments) }}
                            disabled={!canExecute || directoryLoading || !hasRenderableSegments(previewSegments)}>
                            <Send />{sandboxText(locale, "发送")}</Button>
                    </div>

                    {/* Hints: collapsed by default so the composer stays one line tall (#1250). */}
                    <details className="sandbox-hints">
                        <summary><Keyboard size={12} /> {sandboxText(locale, "快捷操作与语法")}</summary>
                        <ul>
                            <li><span className="sandbox-hint-key">Enter</span> {sandboxText(locale, "发送")}</li>
                            <li><span className="sandbox-hint-key">Shift+Enter</span> {sandboxText(locale, "换行")}</li>
                            <li><Paperclip size={11} /> {sandboxText(locale, "拖放、粘贴或用附件按钮上传本地文件，发送时带 Sandbox 托管的签名地址")}</li>
                            {/* Only forms the send path really parses: rendered from the parser's own table. */}
                            {SANDBOX_INBOUND_SYNTAX.map((entry) => (
                                <li key={entry.kind} data-syntax={entry.kind}>
                                    <span className="sandbox-hint-key">{sandboxText(locale, entry.syntax)}</span>
                                    {entry.kind === 'mention' && <> <span className="sandbox-hint-key">[@{endpointId}]</span></>}
                                    {' '}{sandboxText(locale, entry.label)}
                                </li>
                            ))}
                            {commandHints && <li><Terminal size={11} /> {commandHints.prefix
                                ? sandboxText(locale, "命令以 {0} 开头", [commandHints.prefix])
                                : sandboxText(locale, "命令无需前缀")}</li>}
                        </ul>
                    </details>
                </section>
            </main>

            <aside id="sandbox-run-inspector" className={cn("agent-playground-inspector", showInspector && "show")} hidden={!showInspector} aria-hidden={!showInspector} aria-label={sandboxText(locale, "运行检查器")}>
                <div className="agent-playground-inspector-head">
                    <div><span>Run inspector</span><h2>{sandboxText(locale, "运行检查器")}</h2></div>
                    <div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => void loadTrace()} aria-label={sandboxText(locale, "刷新 Agent Trace")} title={sandboxText(locale, "刷新 Agent Trace")} disabled={traceLoading}><RefreshCw className={cn(traceLoading && 'is-spinning')} /></Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => setShowInspector(false)} aria-label={sandboxText(locale, "关闭运行检查器")} title={sandboxText(locale, "关闭运行检查器")}><X /></Button>
                    </div>
                </div>

                <Tabs value={inspectorView} onValueChange={(value) => setInspectorView(value === 'artifacts' ? 'artifacts' : 'runs')}>
                    <TabsList className="sandbox-inspector-tabs" aria-label={sandboxText(locale, "检查器视图")}>
                        <TabsTrigger value="runs"><Activity size={13} />{sandboxText(locale, "任务")}</TabsTrigger>
                        <TabsTrigger value="artifacts"><FileDiff size={13} />{sandboxText(locale, "变更与产物")}<span className="sandbox-tab-count">{workbenchArtifacts.length}</span></TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className={"agent-playground-inspector-view"} hidden={inspectorView !== 'runs'}>

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

                <div className={"agent-playground-inspector-view"} hidden={inspectorView !== 'artifacts'}>
                    <section className="agent-playground-inspector-section agent-playground-artifact-section">
                        <div className="agent-playground-inspector-title"><span>{sandboxText(locale, "文件与命令产物")}</span><small>{workbenchArtifacts.length} items</small></div>
                        {workbenchArtifacts.length > 0 ? (
                            <div className="agent-playground-artifact-list">
                                {workbenchArtifacts.map((artifact) => {
                                    const ArtifactIcon = artifact.kind === 'file-change' ? FileDiff : artifact.kind === 'test' ? FlaskConical : Terminal
                                    const expanded = expandedArtifact === artifact.id
                                    return (
                                        <article key={artifact.id} className={cn(`is-${artifact.status}`, expanded && 'is-expanded')}>
                                            <ListItemButton onClick={() => setExpandedArtifact(expanded ? null : artifact.id)} aria-expanded={expanded}>
                                                <span className="agent-playground-artifact-icon"><ArtifactIcon size={14} /></span>
                                                <span><strong>{artifact.title}</strong><small>{artifact.path ?? artifact.detail ?? artifact.kind}</small></span>
                                                <em>{artifact.status}</em>
                                                <ChevronDown size={14} />
                                            </ListItemButton>
                                            {expanded && (
                                                <div className="agent-playground-artifact-detail">
                                                    {artifact.path && <code>{artifact.path}</code>}
                                                    {canExecute && artifact.projectFilePath && (
                                                        <a href={`/files?${new URLSearchParams({ path: artifact.projectFilePath })}`} target="_blank" rel="noopener noreferrer" className="sandbox-file-link">
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

/** Below the Console `lg` breakpoint (64rem) the conversation list is a drawer (see the workspace styles), so it needs a toggle. */
const DRAWER_LAYOUT_QUERY = '(width < 64rem)'
/** On phones the run bar keeps only the run state, Stop and 「更多」; the rest moves into the menu (D18 第 7 条). */
const COMPACT_RUNBAR_QUERY = '(width < 48rem)'
function useMediaQuery(media: string): boolean {
    const [matches, setMatches] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia(media).matches)
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return
        const query = window.matchMedia(media)
        const update = () => setMatches(query.matches)
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    }, [media])
    return matches
}

function taskStatusLabel(status: 'running' | 'completed' | 'failed' | 'cancelled', locale: SandboxLocale = 'zh-CN'): string {
    if (status === 'running') return sandboxText(locale, "Agent 运行中")
    if (status === 'completed') return sandboxText(locale, "最近任务已完成")
    if (status === 'failed') return sandboxText(locale, "最近任务失败")
    return sandboxText(locale, "最近任务已取消")
}

function messageText(segments: readonly MessageSegment[]): string {
    return segments.map((segment) => {
        const data = (segment.data ?? {}) as Record<string, unknown>
        if (segment.type === 'mention' || segment.type === 'at') return `@${String(data.name ?? data.target ?? '')}`
        return segmentPreviewText(segment)
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
