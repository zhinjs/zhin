import React, { useState, useEffect, useRef } from 'react';
import { MessageSegment, cn } from '@zhin.js/client';
import { User, Users, Trash2, Send, Hash, MessageSquare, Wifi, WifiOff, Smile, Image, AtSign, X, Upload, Check, Info, Search, Bot } from 'lucide-react';
import RichTextEditor, { RichTextEditorRef } from './RichTextEditor';

interface Message {
    id: string; type: 'sent' | 'received'; channelType: 'private' | 'group' | 'channel';
    channelId: string; channelName: string; senderId: string; senderName: string;
    content: MessageSegment[]; timestamp: number;
}

interface Channel { id: string; name: string; type: 'private' | 'group' | 'channel'; unread: number; }
interface Face { id: number; emojiId: number; stickerId: number; emojiType: string; name: string; describe: string; png: boolean; apng: boolean; lottie: boolean; }

export default function Sandbox() {
    const [messages, setMessages] = useState<Message[]>([])
    const [channels, setChannels] = useState<Channel[]>([
        { id: 'user_1001', name: '测试用户', type: 'private', unread: 0 },
        { id: 'group_2001', name: '测试群组', type: 'group', unread: 0 },
        { id: 'channel_3001', name: '测试频道', type: 'channel', unread: 0 }
    ])
    const [faceList, setFaceList] = useState<Face[]>([])
    const [activeChannel, setActiveChannel] = useState<Channel>(channels[0])
    const [inputText, setInputText] = useState('')
    const [botName, setBotName] = useState('ProcessBot')
    const [connected, setConnected] = useState(false)
    const [showFacePicker, setShowFacePicker] = useState(false)
    const [showImageUpload, setShowImageUpload] = useState(false)
    const [showAtPicker, setShowAtPicker] = useState(false)
    const [atPopoverPosition, setAtPopoverPosition] = useState<{ top: number; left: number } | null>(null)
    const [atSearchQuery, setAtSearchQuery] = useState('')
    const [faceSearchQuery, setFaceSearchQuery] = useState('')
    const [imageUrl, setImageUrl] = useState('')
    const [atUserName, setAtUserName] = useState('')
    const [atSuggestions] = useState([
        { id: '10001', name: '张三' }, { id: '10002', name: '李四' }, { id: '10003', name: '王五' },
        { id: '10004', name: '赵六' }, { id: '10005', name: '测试用户' }, { id: '10086', name: 'Admin' },
        { id: '10010', name: 'Test User' }
    ])
    const [previewSegments, setPreviewSegments] = useState<MessageSegment[]>([])
    const [showChannelList, setShowChannelList] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const editorRef = useRef<RichTextEditorRef>(null)

    const fetchFaceList = async () => {
        try { const res = await fetch('https://face.viki.moe/metadata.json'); setFaceList(await res.json()) }
        catch (err) { console.error('[Sandbox] Failed to fetch face list:', err) }
    }

    useEffect(() => { fetchFaceList() }, [])

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        wsRef.current = new WebSocket(`${protocol}//${window.location.host}/sandbox`)
        wsRef.current.onopen = () => setConnected(true)
        wsRef.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                let content: MessageSegment[] = typeof data.content === 'string'
                    ? parseTextToSegments(data.content)
                    : Array.isArray(data.content) ? data.content : parseTextToSegments(String(data.content))

                let targetChannel = channels.find((c) => c.id === data.id)
                if (!targetChannel) {
                    const channelName = data.type === 'private' ? `私聊-${data.bot || botName}` : data.type === 'group' ? `群组-${data.id}` : `频道-${data.id}`
                    targetChannel = { id: data.id, name: channelName, type: data.type, unread: 0 }
                    setChannels((prev) => [...prev, targetChannel!])
                    setActiveChannel(targetChannel)
                }

                const botMessage: Message = {
                    id: `bot_${data.timestamp}`, type: 'received', channelType: data.type,
                    channelId: data.id, channelName: targetChannel.name, senderId: 'bot',
                    senderName: data.bot || botName, content, timestamp: data.timestamp
                }
                setMessages((prev) => [...prev, botMessage])
            } catch (err) { console.error('[Sandbox] Failed to parse message:', err) }
        }
        wsRef.current.onclose = () => setConnected(false)
        return () => { wsRef.current?.close() }
    }, [botName, channels])

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
    useEffect(() => { setPreviewSegments(inputText.trim() ? parseTextToSegments(inputText) : []) }, [inputText])

    const parseTextToSegments = (text: string): MessageSegment[] => {
        const segments: MessageSegment[] = []; const regex = /\[@([^\]]+)\]|\[face:(\d+)\]|\[image:([^\]]+)\]/g
        let lastIndex = 0; let match
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) { const t = text.substring(lastIndex, match.index); if (t) segments.push({ type: 'text', data: { text: t } }) }
            if (match[1]) segments.push({ type: 'at', data: { qq: match[1], name: match[1] } })
            else if (match[2]) segments.push({ type: 'face', data: { id: parseInt(match[2]) } })
            else if (match[3]) segments.push({ type: 'image', data: { url: match[3] } })
            lastIndex = regex.lastIndex
        }
        if (lastIndex < text.length) { const r = text.substring(lastIndex); if (r) segments.push({ type: 'text', data: { text: r } }) }
        return segments.length > 0 ? segments : [{ type: 'text', data: { text } }]
    }

    const renderMessageSegments = (segments: (MessageSegment | string)[]) => {
        return segments.map((segment, index) => {
            if (typeof segment === 'string') {
                return <span key={index}>{segment.split('\n').map((part, i) => <React.Fragment key={i}>{part}{i < segment.split('\n').length - 1 && <br />}</React.Fragment>)}</span>
            }
            switch (segment.type) {
                case 'text': return <span key={index}>{segment.data.text.split('\n').map((part: string, i: number) => <React.Fragment key={i}>{part}{i < segment.data.text.split('\n').length - 1 && <br />}</React.Fragment>)}</span>
                case 'at': return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-xs mx-0.5">@{segment.data.name || segment.data.qq}</span>
                case 'face': return <img key={index} src={`https://face.viki.moe/apng/${segment.data.id}.png`} alt={`face${segment.data.id}`} className="w-6 h-6 inline-block align-middle mx-0.5" />
                case 'image': return <img key={index} src={segment.data.url} alt="image" className="max-w-[300px] rounded-lg my-1 block" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                case 'video': return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded border text-xs mx-0.5">📹 视频</span>
                case 'audio': return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded border text-xs mx-0.5">🎵 语音</span>
                case 'file': return <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded border text-xs mx-0.5">📎 {segment.data.name || '文件'}</span>
                default: return <span key={index}>[未知消息类型]</span>
            }
        })
    }

    const handleSendMessage = (text: string, segments: MessageSegment[]) => {
        if (!text.trim() || segments.length === 0) return
        const newMessage: Message = { id: `msg_${Date.now()}`, type: 'sent', channelType: activeChannel.type, channelId: activeChannel.id, channelName: activeChannel.name, senderId: 'test_user', senderName: '测试用户', content: segments, timestamp: Date.now() }
        setMessages((prev) => [...prev, newMessage]); setInputText(''); setPreviewSegments([])
        editorRef.current?.clear()
        wsRef.current?.send(JSON.stringify({ type: activeChannel.type, id: activeChannel.id, content: segments, timestamp: Date.now() }))
    }

    const clearMessages = () => { if (confirm('确定清空所有消息记录？')) setMessages([]) }
    const switchChannel = (channel: Channel) => { setActiveChannel(channel); setChannels((prev) => prev.map((c) => c.id === channel.id ? { ...c, unread: 0 } : c)); if (window.innerWidth < 768) setShowChannelList(false) }
    const addChannel = () => {
        const types: Array<'private' | 'group' | 'channel'> = ['private', 'group', 'channel']
        const type = types[Math.floor(Math.random() * types.length)]
        const name = prompt(`请输入频道名称：`)
        if (name) { const nc: Channel = { id: `${type}_${Date.now()}`, name, type, unread: 0 }; setChannels((p) => [...p, nc]); setActiveChannel(nc) }
    }
    const getChannelIcon = (type: string) => { switch (type) { case 'private': return <User size={16} />; case 'group': return <Users size={16} />; case 'channel': return <Hash size={16} />; default: return <MessageSquare size={16} /> } }
    const insertFace = (faceId: number) => { editorRef.current?.insertFace(faceId); setShowFacePicker(false) }
    const insertImageUrl = () => { if (!imageUrl.trim()) return; editorRef.current?.insertImage(imageUrl.trim()); setImageUrl(''); setShowImageUpload(false) }
    const insertAtUser = () => { if (!atUserName.trim()) return; editorRef.current?.insertAt(atUserName.trim()); setAtUserName(''); setShowAtPicker(false) }
    const selectAtUser = (user: { id: string; name: string }) => { editorRef.current?.replaceAtTrigger(user.name, user.id); setAtPopoverPosition(null); setAtSearchQuery('') }
    const handleAtTrigger = (show: boolean, searchQuery: string, position?: { top: number; left: number }) => {
        if (activeChannel.type === 'private') { setAtPopoverPosition(null); setAtSearchQuery(''); return }
        if (show && position) { setAtPopoverPosition(position); setAtSearchQuery(searchQuery) } else { setAtPopoverPosition(null); setAtSearchQuery('') }
    }
    const filteredAtSuggestions = atSuggestions.filter((user) => { if (!atSearchQuery.trim()) return true; const q = atSearchQuery.toLowerCase(); return user.name.toLowerCase().includes(q) || user.id.toLowerCase().includes(q) })
    const handleEditorChange = (text: string, segments: MessageSegment[]) => { setInputText(text); setPreviewSegments(segments) }
    const filteredFaces = faceList.filter(face => face.name.toLowerCase().includes(faceSearchQuery.toLowerCase()) || face.describe.toLowerCase().includes(faceSearchQuery.toLowerCase()))
    const channelMessages = messages.filter((msg) => msg.channelId === activeChannel.id)

    return (
        <div className="sandbox-container">
            <button className="mobile-channel-toggle md:hidden" onClick={() => setShowChannelList(!showChannelList)}>
                <MessageSquare size={20} /> 频道列表
            </button>

            {/* Channel sidebar */}
            <div className={cn("channel-sidebar rounded-lg border bg-card", showChannelList && "show")}>
                <div className="p-3 border-b">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded-md bg-secondary"><MessageSquare size={16} className="text-muted-foreground" /></div>
                            <h3 className="font-semibold">频道列表</h3>
                        </div>
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", connected ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" : "bg-muted text-muted-foreground")}>
                            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                            {connected ? '已连接' : '未连接'}
                        </span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {channels.map((channel) => {
                        const isActive = activeChannel.id === channel.id
                        return (
                            <div key={channel.id} className={cn("menu-item", isActive && "active")} onClick={() => switchChannel(channel)}>
                                <span className="shrink-0">{getChannelIcon(channel.type)}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{channel.name}</div>
                                    <div className="text-xs text-muted-foreground">{channel.type === 'private' ? '私聊' : channel.type === 'group' ? '群聊' : '频道'}</div>
                                </div>
                                {channel.unread > 0 && <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1">{channel.unread}</span>}
                            </div>
                        )
                    })}
                </div>

                <div className="p-2 border-t">
                    <button className="w-full py-2 px-3 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-accent transition-colors" onClick={addChannel}>+ 添加频道</button>
                </div>
            </div>

            {showChannelList && <div className="channel-overlay md:hidden" onClick={() => setShowChannelList(false)} />}

            {/* Chat area */}
            <div className="chat-area">
                {/* Top bar */}
                <div className="rounded-lg border bg-card p-3 flex-shrink-0">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-secondary">{getChannelIcon(activeChannel.type)}</div>
                            <div>
                                <h2 className="text-lg font-bold">{activeChannel.name}</h2>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{activeChannel.id}</span>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px]">{channelMessages.length}</span>
                                    <span>条消息</span>
                                </div>
                            </div>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                                {activeChannel.type === 'private' ? '私聊' : activeChannel.type === 'group' ? '群聊' : '频道'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input value={botName} onChange={(e) => setBotName(e.target.value)} placeholder="机器人名称"
                                className="h-8 w-28 rounded-md border bg-transparent px-2 text-sm" />
                            <button className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80" onClick={clearMessages}>
                                <Trash2 size={14} /> 清空
                            </button>
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div className="rounded-lg border bg-card flex-1 flex flex-col min-h-0">
                    <div className="flex-1 overflow-y-auto p-4">
                        {channelMessages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full gap-3">
                                <MessageSquare size={64} className="text-muted-foreground/20" />
                                <span className="text-muted-foreground">暂无消息，开始对话吧！</span>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {channelMessages.map((msg) => (
                                    <div key={msg.id} className={cn("flex", msg.type === 'sent' ? "justify-end" : "justify-start")}>
                                        <div className={cn("max-w-[70%] p-3 rounded-2xl", msg.type === 'sent' ? "bg-primary text-primary-foreground" : "bg-muted")}>
                                            <div className="flex items-center gap-2 mb-1">
                                                {msg.type === 'received' && <Bot size={14} />}
                                                {msg.type === 'sent' && <User size={14} />}
                                                <span className="text-xs font-medium opacity-90">{msg.senderName}</span>
                                                <span className="text-xs opacity-70">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                                            </div>
                                            <div className="text-sm">{renderMessageSegments(msg.content)}</div>
                                        </div>
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                            </div>
                        )}
                    </div>
                </div>

                {/* Input area */}
                <div className="rounded-lg border bg-card p-3 flex-shrink-0 space-y-3">
                    {/* Toolbar */}
                    <div className="flex gap-2 items-center">
                        <button className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", showFacePicker ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setShowFacePicker(!showFacePicker); setShowImageUpload(false) }} title="插入表情">
                            <Smile size={16} />
                        </button>
                        <button className={cn("h-8 w-8 rounded-md flex items-center justify-center border transition-colors", showImageUpload ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            onClick={() => { setShowImageUpload(!showImageUpload); setShowFacePicker(false) }} title="插入图片">
                            <Image size={16} />
                        </button>
                        <div className="flex-1" />
                        {inputText && (
                            <button className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-accent transition-colors"
                                onClick={() => { setInputText(''); setPreviewSegments([]) }}><X size={16} /></button>
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

                    {/* Image upload */}
                    {showImageUpload && (
                        <div className="p-3 rounded-md border bg-muted/30 space-y-2">
                            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="输入图片 URL..."
                                className="w-full h-8 rounded-md border bg-transparent px-2 text-sm"
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertImageUrl() } }} />
                            <button className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                                onClick={insertImageUrl} disabled={!imageUrl.trim()}>
                                <Check size={14} /> 插入
                            </button>
                        </div>
                    )}

                    {/* Editor + send */}
                    <div className="flex gap-2 items-start">
                        <div className="flex-1 relative">
                            <RichTextEditor
                                ref={editorRef} placeholder={`向 ${activeChannel.name} 发送消息...`}
                                onSend={handleSendMessage} onChange={handleEditorChange} onAtTrigger={handleAtTrigger}
                                minHeight="44px" maxHeight="200px"
                            />
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
                            disabled={!inputText.trim() || previewSegments.length === 0}>
                            <Send size={16} /> 发送
                        </button>
                    </div>

                    {/* Hints */}
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <Info size={12} /> 快捷操作:
                        <span className="px-1 py-0.5 rounded border text-[10px]">Enter</span> 发送
                        <span className="px-1 py-0.5 rounded border text-[10px]">Shift+Enter</span> 换行
                        <span className="px-1 py-0.5 rounded border text-[10px]">[@名称]</span> @某人
                    </div>
                </div>
            </div>
        </div>
    )
}
