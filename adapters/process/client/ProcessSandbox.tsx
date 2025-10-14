import { useState, useEffect, useRef } from 'react';
import { MessageSegment, cn } from '@zhin.js/client';
import { Flex, Box, Heading, Text, Badge, Button, Card, Tabs, TextField, Grid } from '@radix-ui/themes';
import { User, Users, Trash2, Send, Hash, MessageSquare, Wifi, WifiOff, Smile, Image, AtSign, X, Upload, Check, Info, Search, Bot } from 'lucide-react';
import RichTextEditor, { RichTextEditorRef } from './RichTextEditor';

interface Message {
    id: string
    type: 'sent' | 'received'
    channelType: 'private' | 'group' | 'channel'
    channelId: string
    channelName: string
    senderId: string
    senderName: string
    content: MessageSegment[]
    timestamp: number
}

interface Channel {
    id: string
    name: string
    type: 'private' | 'group' | 'channel'
    unread: number
}

interface Face {
    id: number
    emojiId: number
    stickerId: number
    emojiType: string
    name: string
    describe: string
    png: boolean
    apng: boolean
    lottie: boolean
}

export default function ProcessSandbox() {
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
        { id: '10001', name: '张三' },
        { id: '10002', name: '李四' },
        { id: '10003', name: '王五' },
        { id: '10004', name: '赵六' },
        { id: '10005', name: '测试用户' },
        { id: '10086', name: 'Admin' },
        { id: '10010', name: 'Test User' }
    ])
    const [previewSegments, setPreviewSegments] = useState<MessageSegment[]>([])
    const [showChannelList, setShowChannelList] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const editorRef = useRef<RichTextEditorRef>(null)

    // 获取表情列表
    const fetchFaceList = async () => {
        try {
            const res = await fetch('https://face.viki.moe/metadata.json')
            const data = await res.json()
            setFaceList(data)
        } catch (err) {
            console.error('[ProcessSandbox] Failed to fetch face list:', err)
        }
    }

    useEffect(() => {
        fetchFaceList()
    }, [])

    // WebSocket 连接
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        wsRef.current = new WebSocket(`${protocol}//${window.location.host}/sandbox`)

        wsRef.current.onopen = () => {
            console.log('[ProcessSandbox] WebSocket connected')
            setConnected(true)
        }

        wsRef.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                const botMessage: Message = {
                    id: `bot_${data.timestamp}`,
                    type: 'received',
                    channelType: data.type,
                    channelId: data.id,
                    channelName: channels.find((c: Channel) => c.id === data.id)?.name || data.id,
                    senderId: 'bot',
                    senderName: data.bot || botName,
                    content: data.content,
                    timestamp: data.timestamp
                }
                setMessages((prev: Message[]) => [...prev, botMessage])
            } catch (err) {
                console.error('[ProcessSandbox] Failed to parse message:', err)
            }
        }

        wsRef.current.onclose = () => {
            console.log('[ProcessSandbox] WebSocket disconnected')
            setConnected(false)
        }

        return () => {
            wsRef.current?.close()
        }
    }, [botName, channels])

    // 自动滚动
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // 实时预览
    useEffect(() => {
        if (inputText.trim()) {
            const segments = parseTextToSegments(inputText)
            setPreviewSegments(segments)
        } else {
            setPreviewSegments([])
        }
    }, [inputText])

    // 解析文本为消息段
    const parseTextToSegments = (text: string): MessageSegment[] => {
        const segments: MessageSegment[] = []
        const regex = /\[@([^\]]+)\]|\[face:(\d+)\]|\[image:([^\]]+)\]/g
        let lastIndex = 0
        let match

        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                const textContent = text.substring(lastIndex, match.index)
                if (textContent) {
                    segments.push({ type: 'text', data: { text: textContent } })
                }
            }

            if (match[1]) {
                segments.push({ type: 'at', data: { qq: match[1], name: match[1] } })
            } else if (match[2]) {
                segments.push({ type: 'face', data: { id: parseInt(match[2]) } })
            } else if (match[3]) {
                segments.push({ type: 'image', data: { url: match[3] } })
            }

            lastIndex = regex.lastIndex
        }

        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex)
            if (remainingText) {
                segments.push({ type: 'text', data: { text: remainingText } })
            }
        }

        return segments.length > 0 ? segments : [{ type: 'text', data: { text: text } }]
    }

    // 渲染消息段
    const renderMessageSegments = (segments: MessageSegment[]) => {
        return segments.map((segment, index) => {
            switch (segment.type) {
                case 'text':
                    return <span key={index}>{segment.data.text}</span>
                case 'at':
                    return (
                        <Badge key={index} color="blue" variant="soft" style={{ margin: '0 2px' }}>
                            @{segment.data.name || segment.data.qq}
                        </Badge>
                    )
                case 'face':
                    return (
                        <img
                            key={index}
                            src={`https://face.viki.moe/apng/${segment.data.id}.png`}
                            alt={`表情${segment.data.id}`}
                            style={{ width: '24px', height: '24px', display: 'inline-block', verticalAlign: 'middle', margin: '0 2px' }}
                        />
                    )
                case 'image':
                    return (
                        <img
                            key={index}
                            src={segment.data.url}
                            alt="图片"
                            style={{ maxWidth: '300px', borderRadius: '8px', margin: '4px 0', display: 'block' }}
                            onError={(e) => { e.currentTarget.style.display = 'none' }}
                        />
                    )
                case 'video':
                    return (
                        <Badge key={index} variant="outline" style={{ margin: '0 2px' }}>
                            📹 视频
                        </Badge>
                    )
                case 'audio':
                    return (
                        <Badge key={index} variant="outline" style={{ margin: '0 2px' }}>
                            🎵 语音
                        </Badge>
                    )
                case 'file':
                    return (
                        <Badge key={index} variant="outline" style={{ margin: '0 2px' }}>
                            📎 {segment.data.name || '文件'}
                        </Badge>
                    )
                default:
                    return <span key={index}>[未知消息类型]</span>
            }
        })
    }

    // 发送消息
    const handleSendMessage = (text: string, segments: MessageSegment[]) => {
        if (!text.trim() || segments.length === 0) return

        const newMessage: Message = {
            id: `msg_${Date.now()}`,
            type: 'sent',
            channelType: activeChannel.type,
            channelId: activeChannel.id,
            channelName: activeChannel.name,
            senderId: 'test_user',
            senderName: '测试用户',
            content: segments,
            timestamp: Date.now()
        }

        setMessages((prev: Message[]) => [...prev, newMessage])
        setInputText('')
        setPreviewSegments([])

        // 清空编辑器
        editorRef.current?.clear()

        wsRef.current?.send(JSON.stringify({
            type: activeChannel.type,
            id: activeChannel.id,
            content: segments,
            timestamp: Date.now()
        }))
    }

    // 清空消息
    const clearMessages = () => {
        if (confirm('确定清空所有消息记录？')) {
            setMessages([])
        }
    }

    // 切换频道
    const switchChannel = (channel: Channel) => {
        setActiveChannel(channel)
        setChannels((prev: Channel[]) =>
            prev.map((c: Channel) => (c.id === channel.id ? { ...c, unread: 0 } : c))
        )
        // 移动端切换频道后自动关闭侧边栏
        if (window.innerWidth < 768) {
            setShowChannelList(false)
        }
    }

    // 添加新频道
    const addChannel = () => {
        const types: Array<'private' | 'group' | 'channel'> = ['private', 'group', 'channel']
        const typeNames = { private: '私聊', group: '群聊', guild: '频道' }
        const type = types[Math.floor(Math.random() * types.length)]
        const id = `${type}_${Date.now()}`
        const name = prompt(`请输入${typeNames[type]}名称：`)

        if (name) {
            const newChannel: Channel = { id, name, type, unread: 0 }
            setChannels((prev: Channel[]) => [...prev, newChannel])
            setActiveChannel(newChannel)
        }
    }

    // 获取频道图标
    const getChannelIcon = (type: string) => {
        switch (type) {
            case 'private': return <User size={16} />
            case 'group': return <Users size={16} />
            case 'channel': return <Hash size={16} />
            default: return <MessageSquare size={16} />
        }
    }

    // 插入表情
    const insertFace = (faceId: number) => {
        editorRef.current?.insertFace(faceId)
        setShowFacePicker(false)
    }

    // 插入图片
    const insertImageUrl = () => {
        if (!imageUrl.trim()) return
        editorRef.current?.insertImage(imageUrl.trim())
        setImageUrl('')
        setShowImageUpload(false)
    }

    // 插入 @ 某人（手动点击按钮）
    const insertAtUser = () => {
        if (!atUserName.trim()) return
        editorRef.current?.insertAt(atUserName.trim())
        setAtUserName('')
        setShowAtPicker(false)
    }

    // 选择 @ 提及用户（自动触发）
    const selectAtUser = (user: { id: string; name: string }) => {
        editorRef.current?.replaceAtTrigger(user.name, user.id)
        setAtPopoverPosition(null)
        setAtSearchQuery('')
    }

    // 处理 @ 触发
    const handleAtTrigger = (show: boolean, searchQuery: string, position?: { top: number; left: number }) => {
        // 仅在群聊或频道中启用 @ 功能
        if (activeChannel.type === 'private') {
            setAtPopoverPosition(null)
            setAtSearchQuery('')
            return
        }

        if (show && position) {
            setAtPopoverPosition(position)
            setAtSearchQuery(searchQuery)
        } else {
            setAtPopoverPosition(null)
            setAtSearchQuery('')
        }
    }

    // 过滤用户列表（根据 @ 后面输入的内容）
    const filteredAtSuggestions = atSuggestions.filter((user) => {
        if (!atSearchQuery.trim()) return true
        const query = atSearchQuery.toLowerCase()
        return (
            user.name.toLowerCase().includes(query) ||
            user.id.toLowerCase().includes(query)
        )
    })

    // 处理编辑器内容变化
    const handleEditorChange = (text: string, segments: MessageSegment[]) => {
        setInputText(text)
        setPreviewSegments(segments)
    }

    // 处理文件上传
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = (event) => {
            const dataUrl = event.target?.result as string
            setInputText(prev => prev + `[image:${dataUrl}]`)
            setShowImageUpload(false)
        }
        reader.readAsDataURL(file)
    }

    // 筛选表情
    const filteredFaces = faceList.filter(face =>
        face.name.toLowerCase().includes(faceSearchQuery.toLowerCase()) ||
        face.describe.toLowerCase().includes(faceSearchQuery.toLowerCase())
    )

    // 筛选当前频道的消息
    const channelMessages = messages.filter(
        (msg: Message) => msg.channelId === activeChannel.id
    )

    return (
        <div className="sandbox-container">
            {/* 移动端频道列表切换按钮 */}
            <button
                className="mobile-channel-toggle md:hidden"
                onClick={() => setShowChannelList(!showChannelList)}
            >
                <MessageSquare size={20} />
                频道列表
            </button>

            {/* 左侧频道列表 */}
            <Card className={cn("channel-sidebar", showChannelList && "show")}>
                <Box p="3" style={{ borderBottom: '1px solid var(--gray-6)' }}>
                    <Flex justify="between" align="center" mb="2">
                        <Flex align="center" gap="2">
                            <Box p="1" style={{ borderRadius: '8px', backgroundColor: 'var(--purple-3)' }}>
                                <MessageSquare size={16} color="var(--purple-9)" />
                            </Box>
                            <Heading size="4">频道列表</Heading>
                        </Flex>
                        <Badge color={connected ? 'green' : 'gray'}>
                            <Flex align="center" gap="1">
                                {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                                {connected ? '已连接' : '未连接'}
                            </Flex>
                        </Badge>
                    </Flex>
                </Box>

                <Box style={{ flex: 1, overflowY: 'auto' }} p="3">
                    <Flex direction="column" gap="2">
                        {channels.map((channel: Channel) => {
                            const isActive = activeChannel.id === channel.id
                            return (
                                <div
                                    key={channel.id}
                                    className={cn("channel-item", isActive && "active")}
                                    onClick={() => switchChannel(channel)}
                                >
                                    <div className="icon">
                                        {getChannelIcon(channel.type)}
                                    </div>
                                    <div className="text">
                                        <div className="title">{channel.name}</div>
                                        <div className="subtitle">
                                            {channel.type === 'private' && '私聊'}
                                            {channel.type === 'group' && '群聊'}
                                            {channel.type === 'channel' && '频道'}
                                        </div>
                                    </div>
                                    {channel.unread > 0 && (
                                        <Badge color="red" size="1" className="badge">
                                            {channel.unread}
                                        </Badge>
                                    )}
                                    {isActive && <div className="indicator" />}
                                </div>
                            )
                        })}
                    </Flex>
                </Box>

                <Box p="2" style={{ borderTop: '1px solid var(--gray-6)' }}>
                    <Button variant="outline" onClick={addChannel} style={{ width: '100%' }}>
                        + 添加频道
                    </Button>
                </Box>
            </Card>

            {/* 遮罩层 - 移动端点击关闭频道列表 */}
            {showChannelList && (
                <div
                    className="channel-overlay md:hidden"
                    onClick={() => setShowChannelList(false)}
                />
            )}

            {/* 右侧聊天区域 */}
            <div className="chat-area">
                {/* 顶部信息栏 */}
                <Card>
                    <Flex justify="between" align="center" p="3">
                        <Flex align="center" gap="3">
                            <Box p="2" style={{ borderRadius: '12px', backgroundColor: 'var(--blue-3)' }}>
                                {getChannelIcon(activeChannel.type)}
                            </Box>
                            <Box>
                                <Heading size="5">{activeChannel.name}</Heading>
                                <Flex align="center" gap="2">
                                    <Text size="1" color="gray">{activeChannel.id}</Text>
                                    <Badge variant="outline" size="1">{channelMessages.length}</Badge>
                                    <Text size="1" color="gray">条消息</Text>
                                </Flex>
                            </Box>
                            <Badge color={activeChannel.type === 'private' ? 'blue' : activeChannel.type === 'group' ? 'green' : 'purple'}>
                                {activeChannel.type === 'private' && '私聊'}
                                {activeChannel.type === 'group' && '群聊'}
                                {activeChannel.type === 'channel' && '频道'}
                            </Badge>
                        </Flex>
                        <Flex align="center" gap="2">
                            <TextField.Root
                                value={botName}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBotName(e.target.value)}
                                placeholder="机器人名称"
                                style={{ width: '120px' }}
                            />
                            <Button variant="soft" onClick={clearMessages}>
                                <Trash2 size={16} />
                                清空
                            </Button>
                        </Flex>
                    </Flex>
                </Card>

                {/* 消息列表 */}
                <Card style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Box style={{ flex: 1, overflowY: 'auto' }} p="4">
                        {channelMessages.length === 0 ? (
                            <Flex direction="column" align="center" justify="center" style={{ height: '100%' }}>
                                <MessageSquare size={64} color="var(--gray-6)" />
                                <Text color="gray" mt="3">暂无消息，开始对话吧！</Text>
                            </Flex>
                        ) : (
                            <Flex direction="column" gap="2">
                                {channelMessages.map((msg: Message) => (
                                    <Flex
                                        key={msg.id}
                                        justify={msg.type === 'sent' ? 'end' : 'start'}
                                    >
                                        <Box
                                            style={{
                                                maxWidth: '70%',
                                                padding: '12px',
                                                borderRadius: '16px',
                                                backgroundColor: msg.type === 'sent' ? 'var(--blue-9)' : 'var(--gray-3)',
                                                color: msg.type === 'sent' ? 'white' : 'var(--gray-12)'
                                            }}
                                        >
                                            <Flex align="center" gap="2" mb="1">
                                                {msg.type === 'received' && <Bot size={14} />}
                                                {msg.type === 'sent' && <User size={14} />}
                                                <Text size="1" weight="medium" style={{ opacity: 0.9 }}>
                                                    {msg.senderName}
                                                </Text>
                                                <Text size="1" style={{ opacity: 0.7 }}>
                                                    {new Date(msg.timestamp).toLocaleTimeString()}
                                                </Text>
                                            </Flex>
                                            <Text size="2">
                                                {renderMessageSegments(msg.content)}
                                            </Text>
                                        </Box>
                                    </Flex>
                                ))}
                                <div ref={messagesEndRef} />
                            </Flex>
                        )}
                    </Box>
                </Card>

                {/* 输入框 */}
                <Card>
                    <Flex direction="column" gap="3" p="3">
                        {/* 工具栏 */}
                        <Flex gap="2" align="center">
                            <Button
                                variant={showFacePicker ? 'solid' : 'outline'}
                                size="2"
                                onClick={() => {
                                    setShowFacePicker(!showFacePicker)
                                    setShowImageUpload(false)
                                }}
                                title="插入表情"
                            >
                                <Smile size={16} />
                            </Button>

                            <Button
                                variant={showImageUpload ? 'solid' : 'outline'}
                                size="2"
                                onClick={() => {
                                    setShowImageUpload(!showImageUpload)
                                    setShowFacePicker(false)
                                }}
                                title="插入图片"
                            >
                                <Image size={16} />
                            </Button>
                            <Box style={{ flex: 1 }} />

                            {inputText && (
                                <Button
                                    variant="ghost"
                                    size="2"
                                    onClick={() => {
                                        setInputText('')
                                        setPreviewSegments([])
                                    }}
                                    title="清空"
                                >
                                    <X size={16} />
                                </Button>
                            )}
                        </Flex>

                        {/* 表情选择器 */}
                        {showFacePicker && (
                            <Box p="3" style={{ border: '1px solid var(--gray-6)', borderRadius: '8px', backgroundColor: 'var(--gray-1)', maxHeight: '256px', overflowY: 'auto' }}>
                                <TextField.Root
                                    value={faceSearchQuery}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFaceSearchQuery(e.target.value)}
                                    placeholder="搜索表情..."
                                    style={{ marginBottom: '8px' }}
                                />
                                <Grid columns="8" gap="2">
                                    {filteredFaces.slice(0, 80).map((face) => (
                                        <button
                                            key={face.id}
                                            onClick={() => insertFace(face.id)}
                                            style={{
                                                width: '40px',
                                                height: '40px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--gray-6)',
                                                backgroundColor: 'transparent',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                            title={face.name}
                                        >
                                            <img
                                                src={`https://face.viki.moe/apng/${face.id}.png`}
                                                alt={face.name}
                                                style={{ width: '32px', height: '32px' }}
                                            />
                                        </button>
                                    ))}
                                </Grid>
                                {filteredFaces.length === 0 && (
                                    <Flex direction="column" align="center" gap="2" py="4">
                                        <Search size={32} color="var(--gray-6)" />
                                        <Text size="2" color="gray">未找到匹配的表情</Text>
                                    </Flex>
                                )}
                            </Box>
                        )}

                        {/* 图片上传 */}
                        {showImageUpload && (
                            <Box p="3" style={{ border: '1px solid var(--gray-6)', borderRadius: '8px', backgroundColor: 'var(--gray-1)' }}>
                                <Tabs.Root defaultValue="url">
                                    <Tabs.List>
                                        <Tabs.Trigger value="url">图片链接</Tabs.Trigger>
                                        <Tabs.Trigger value="upload">本地上传</Tabs.Trigger>
                                    </Tabs.List>
                                    <Box pt="3">
                                        <Flex direction="column" gap="2">
                                            <TextField.Root
                                                value={imageUrl}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImageUrl(e.target.value)}
                                                placeholder="输入图片 URL..."
                                                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        insertImageUrl()
                                                    }
                                                }}
                                            />
                                            <Button onClick={insertImageUrl} disabled={!imageUrl.trim()}>
                                                <Check size={16} />
                                                插入
                                            </Button>
                                        </Flex>
                                    </Box>
                                </Tabs.Root>
                            </Box>
                        )}

                        {/* @ 某人 */}
                        {showAtPicker && (
                            <Box p="3" style={{ border: '1px solid var(--gray-6)', borderRadius: '8px', backgroundColor: 'var(--gray-1)' }}>
                                <Flex direction="column" gap="2">
                                    <TextField.Root
                                        value={atUserName}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAtUserName(e.target.value)}
                                        placeholder="输入用户名..."
                                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                insertAtUser()
                                            }
                                        }}
                                    />
                                    <Button onClick={insertAtUser} disabled={!atUserName.trim()}>
                                        <Check size={16} />
                                        插入
                                    </Button>
                                </Flex>
                            </Box>
                        )}

                        {/* 富文本编辑器和发送按钮 */}
                        <Flex gap="2" align="start">
                            <Box style={{ flex: 1, position: 'relative' }}>
                                <RichTextEditor
                                    ref={editorRef}
                                    placeholder={`向 ${activeChannel.name} 发送消息...`}
                                    onSend={handleSendMessage}
                                    onChange={handleEditorChange}
                                    onAtTrigger={handleAtTrigger}
                                    minHeight="44px"
                                    maxHeight="200px"
                                />
                                
                                {/* @ 用户选择 Popover */}
                                {atPopoverPosition && (
                                    <Box
                                        style={{
                                            position: 'absolute',
                                            top: `${atPopoverPosition.top}px`,
                                            left: `${atPopoverPosition.left}px`,
                                            zIndex: 1000,
                                            backgroundColor: 'var(--gray-1)',
                                            border: '1px solid var(--gray-6)',
                                            borderRadius: '8px',
                                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                                            minWidth: '240px',
                                            maxHeight: '280px',
                                            overflowY: 'auto',
                                            padding: '4px'
                                        }}
                                    >
                                        {filteredAtSuggestions.length > 0 ? (
                                            filteredAtSuggestions.map((user) => (
                                                <Flex
                                                    key={user.id}
                                                    align="center"
                                                    gap="2"
                                                    p="2"
                                                    onClick={() => selectAtUser(user)}
                                                    style={{
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.backgroundColor = 'var(--blue-a3)'
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.backgroundColor = 'transparent'
                                                    }}
                                                >
                                                    <User size={16} color="var(--blue-9)" />
                                                    <Flex direction="column" gap="0" style={{ flex: 1 }}>
                                                        <Text size="2" weight="medium">{user.name}</Text>
                                                        <Text size="1" color="gray">ID: {user.id}</Text>
                                                    </Flex>
                                                </Flex>
                                            ))
                                        ) : (
                                            <Flex
                                                align="center"
                                                justify="center"
                                                p="4"
                                                direction="column"
                                                gap="2"
                                            >
                                                <Search size={20} color="var(--gray-8)" />
                                                <Text size="1" color="gray">未找到匹配的用户</Text>
                                            </Flex>
                                        )}
                                    </Box>
                                )}
                            </Box>
                            <Button
                                onClick={() => {
                                    const content = editorRef.current?.getContent()
                                    if (content) {
                                        handleSendMessage(content.text, content.segments)
                                    }
                                }}
                                disabled={!inputText.trim() || previewSegments.length === 0}
                                size="3"
                                title="发送消息 (Enter)"
                            >
                                <Send size={16} />
                                发送
                            </Button>
                        </Flex>

                        {/* 提示信息 */}
                        <Flex align="center" gap="2" wrap="wrap">
                            <Info size={12} color="var(--gray-9)" />
                            <Text size="1" color="gray">快捷操作:</Text>
                            <Badge variant="outline" size="1">Enter</Badge>
                            <Text size="1" color="gray">发送</Text>
                            <Badge variant="outline" size="1">Shift+Enter</Badge>
                            <Text size="1" color="gray">换行</Text>
                            <Badge variant="outline" size="1">[@名称]</Badge>
                            <Text size="1" color="gray">@某人</Text>
                        </Flex>
                    </Flex>
                </Card>
            </div>
        </div>
    )
}
