import { describe, it, expect, vi } from 'vitest'
import { Message, MessageBase, MessageChannel, MessageType } from '../src/message'
import { MessageSegment, MessageSender } from '../src/types'

describe('Message系统测试', () => {
  describe('Message类型定义测试', () => {
    it('应该正确定义MessageChannel接口', () => {
      const channel: MessageChannel = {
        id: 'test-channel-123',
        type: 'private'
      }

      expect(channel.id).toBe('test-channel-123')
      expect(channel.type).toBe('private')
    })

    it('应该支持所有MessageType类型', () => {
      const privateType: MessageType = 'private'
      const groupType: MessageType = 'group'
      const channelType: MessageType = 'channel'

      expect(privateType).toBe('private')
      expect(groupType).toBe('group')
      expect(channelType).toBe('channel')
    })

    it('应该正确定义MessageBase接口', () => {
      const mockReply = vi.fn().mockResolvedValue(undefined)
      const sender: MessageSender = {
        id: 'user-123',
        name: 'Test User',
        avatar: 'https://example.com/avatar.png'
      }

      const messageBase: MessageBase = {
        $id: 'msg-123',
        $adapter: 'test-adapter',
        $bot: 'test-bot',
        $content: [
          { type: 'text', data: { text: 'Hello World' } }
        ],
        $sender: sender,
        $reply: mockReply,
        $channel: { id: 'channel-123', type: 'private' },
        $timestamp: Date.now(),
        $raw: 'Hello World'
      }

      expect(messageBase.$id).toBe('msg-123')
      expect(messageBase.$adapter).toBe('test-adapter')
      expect(messageBase.$bot).toBe('test-bot')
      expect(messageBase.$content).toHaveLength(1)
      expect(messageBase.$content[0].type).toBe('text')
      expect(messageBase.$sender.id).toBe('user-123')
      expect(typeof messageBase.$reply).toBe('function')
      expect(messageBase.$channel.id).toBe('channel-123')
      expect(messageBase.$timestamp).toBeTypeOf('number')
      expect(messageBase.$raw).toBe('Hello World')
    })
  })

  describe('Message工厂函数测试', () => {
    it('应该使用Message.from创建消息对象', () => {
      const mockReply = vi.fn().mockResolvedValue(undefined)
      const customData = {
        platform: 'discord',
        serverId: 'server-123',
        messageId: 'discord-msg-456'
      }

      const messageBase: MessageBase = {
        $id: 'msg-123',
        $adapter: 'discord',
        $bot: 'discord-bot',
        $content: [
          { type: 'text', data: { text: 'Hello from Discord' } }
        ],
        $sender: {
          id: 'user-456',
          name: 'Discord User'
        },
        $reply: mockReply,
        $channel: { id: 'discord-channel', type: 'channel' },
        $timestamp: Date.now(),
        $raw: 'Hello from Discord'
      }

      const message = Message.from(customData, messageBase)

      // 验证合并结果
      expect(message.$id).toBe('msg-123')
      expect(message.$adapter).toBe('discord')
      expect(message.platform).toBe('discord')
      expect(message.serverId).toBe('server-123')
      expect(message.messageId).toBe('discord-msg-456')
      expect(typeof message.$reply).toBe('function')
    })

    it('应该保持原始数据的属性', () => {
      const mockReply = vi.fn()
      const originalData = {
        customField: 'custom-value',
        nested: {
          prop: 'nested-value'
        }
      }

      const messageBase: MessageBase = {
        $id: 'msg-456',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [],
        $sender: { id: 'user', name: 'User' },
        $reply: mockReply,
        $channel: { id: 'channel', type: 'private' },
        $timestamp: Date.now(),
        $raw: 'test'
      }

      const message = Message.from(originalData, messageBase)

      expect(message.customField).toBe('custom-value')
      expect(message.nested.prop).toBe('nested-value')
      expect(message.$id).toBe('msg-456')
    })

    it('应该正确处理泛型类型', () => {
      interface DiscordMessage {
        guildId?: string
        channelId: string
        authorId: string
      }

      const discordData: DiscordMessage = {
        guildId: 'guild-123',
        channelId: 'channel-456',
        authorId: 'author-789'
      }

      const messageBase: MessageBase = {
        $id: 'msg-789',
        $adapter: 'discord',
        $bot: 'discord-bot',
        $content: [
          { type: 'text', data: { text: 'Discord message' } }
        ],
        $sender: { id: 'author-789', name: 'Discord Author' },
        $reply: vi.fn(),
        $channel: { id: 'channel-456', type: 'channel' },
        $timestamp: Date.now(),
        $raw: 'Discord message'
      }

      const message: Message<DiscordMessage> = Message.from(discordData, messageBase)

      // TypeScript类型检查 + 运行时验证
      expect(message.guildId).toBe('guild-123')
      expect(message.channelId).toBe('channel-456')
      expect(message.authorId).toBe('author-789')
      expect(message.$adapter).toBe('discord')
    })
  })

  describe('消息内容处理测试', () => {
    it('应该正确处理文本消息', () => {
      const textSegment: MessageSegment = {
        type: 'text',
        data: { text: '这是一条文本消息' }
      }

      const messageBase: MessageBase = {
        $id: 'text-msg',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [textSegment],
        $sender: { id: 'user', name: 'User' },
        $reply: vi.fn(),
        $channel: { id: 'channel', type: 'private' },
        $timestamp: Date.now(),
        $raw: '这是一条文本消息'
      }

      expect(messageBase.$content[0].type).toBe('text')
      expect(messageBase.$content[0].data.text).toBe('这是一条文本消息')
    })

    it('应该正确处理多媒体消息', () => {
      const multiSegments: MessageSegment[] = [
        { type: 'text', data: { text: '看看这张图片：' } },
        { type: 'image', data: { url: 'https://example.com/image.png' } },
        { type: 'text', data: { text: '很漂亮吧！' } }
      ]

      const messageBase: MessageBase = {
        $id: 'multi-msg',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: multiSegments,
        $sender: { id: 'user', name: 'User' },
        $reply: vi.fn(),
        $channel: { id: 'channel', type: 'group' },
        $timestamp: Date.now(),
        $raw: '看看这张图片：[图片]很漂亮吧！'
      }

      expect(messageBase.$content).toHaveLength(3)
      expect(messageBase.$content[0].type).toBe('text')
      expect(messageBase.$content[1].type).toBe('image')
      expect(messageBase.$content[2].type).toBe('text')
      expect(messageBase.$content[1].data.url).toBe('https://example.com/image.png')
    })

    it('应该正确处理特殊消息类型', () => {
      const specialSegments: MessageSegment[] = [
        { type: 'at', data: { user_id: 'user-123', name: '@张三' } },
        { type: 'emoji', data: { id: 'emoji-456', name: '😀' } },
        { type: 'file', data: { url: 'https://example.com/file.pdf', name: 'document.pdf' } }
      ]

      const messageBase: MessageBase = {
        $id: 'special-msg',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: specialSegments,
        $sender: { id: 'user', name: 'User' },
        $reply: vi.fn(),
        $channel: { id: 'channel', type: 'group' },
        $timestamp: Date.now(),
        $raw: '@张三 😀 [文件: document.pdf]'
      }

      expect(messageBase.$content[0].type).toBe('at')
      expect(messageBase.$content[0].data.user_id).toBe('user-123')
      expect(messageBase.$content[1].type).toBe('emoji')
      expect(messageBase.$content[1].data.name).toBe('😀')
      expect(messageBase.$content[2].type).toBe('file')
      expect(messageBase.$content[2].data.name).toBe('document.pdf')
    })
  })

  describe('消息回复功能测试', () => {
    it('应该正确处理基本回复', async () => {
      const mockReply = vi.fn().mockResolvedValue(undefined)
      
      const message: Message = {
        $id: 'reply-test',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [{ type: 'text', data: { text: 'hello' } }],
        $sender: { id: 'user', name: 'User' },
        $reply: mockReply,
        $channel: { id: 'channel', type: 'private' },
        $timestamp: Date.now(),
        $raw: 'hello'
      }

      await message.$reply('Hello back!')

      expect(mockReply).toHaveBeenCalledWith('Hello back!')
    })

    it('应该正确处理带引用的回复', async () => {
      const mockReply = vi.fn().mockResolvedValue(undefined)
      
      const message: Message = {
        $id: 'quote-test',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [{ type: 'text', data: { text: 'original message' } }],
        $sender: { id: 'user', name: 'User' },
        $reply: mockReply,
        $channel: { id: 'channel', type: 'group' },
        $timestamp: Date.now(),
        $raw: 'original message'
      }

      await message.$reply('Quoted reply', true)
      await message.$reply('Custom quote', 'custom-quote-id')

      expect(mockReply).toHaveBeenCalledWith('Quoted reply', true)
      expect(mockReply).toHaveBeenCalledWith('Custom quote', 'custom-quote-id')
    })

    it('应该正确处理回复失败', async () => {
      const mockReply = vi.fn().mockRejectedValue(new Error('回复失败'))
      
      const message: Message = {
        $id: 'fail-test',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [{ type: 'text', data: { text: 'test' } }],
        $sender: { id: 'user', name: 'User' },
        $reply: mockReply,
        $channel: { id: 'channel', type: 'private' },
        $timestamp: Date.now(),
        $raw: 'test'
      }

      await expect(message.$reply('This will fail')).rejects.toThrow('回复失败')
    })
  })

  describe('发送者信息测试', () => {
    it('应该正确处理基本发送者信息', () => {
      const sender: MessageSender = {
        id: 'sender-123',
        name: '发送者'
      }

      const message: Message = {
        $id: 'sender-test',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [],
        $sender: sender,
        $reply: vi.fn(),
        $channel: { id: 'channel', type: 'private' },
        $timestamp: Date.now(),
        $raw: ''
      }

      expect(message.$sender.id).toBe('sender-123')
      expect(message.$sender.name).toBe('发送者')
      expect(message.$sender.avatar).toBeUndefined()
    })

    it('应该正确处理完整发送者信息', () => {
      const sender: MessageSender = {
        id: 'sender-456',
        name: '完整发送者',
        avatar: 'https://example.com/avatar.jpg',
        nickname: '昵称',
        roles: ['admin', 'moderator']
      }

      const message: Message = {
        $id: 'full-sender-test',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [],
        $sender: sender,
        $reply: vi.fn(),
        $channel: { id: 'channel', type: 'group' },
        $timestamp: Date.now(),
        $raw: ''
      }

      expect(message.$sender.avatar).toBe('https://example.com/avatar.jpg')
      expect(message.$sender.nickname).toBe('昵称')
      expect(message.$sender.roles).toEqual(['admin', 'moderator'])
    })
  })

  describe('消息时间戳测试', () => {
    it('应该正确处理时间戳', () => {
      const timestamp = Date.now()
      
      const message: Message = {
        $id: 'timestamp-test',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [],
        $sender: { id: 'user', name: 'User' },
        $reply: vi.fn(),
        $channel: { id: 'channel', type: 'private' },
        $timestamp: timestamp,
        $raw: ''
      }

      expect(message.$timestamp).toBe(timestamp)
      expect(typeof message.$timestamp).toBe('number')
      expect(message.$timestamp).toBeGreaterThan(0)
    })
  })

  describe('原始消息内容测试', () => {
    it('应该保留原始消息内容', () => {
      const rawContent = 'This is the raw message content with emojis 😀 and @mentions'
      
      const message: Message = {
        $id: 'raw-test',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [
          { type: 'text', data: { text: 'This is the raw message content with emojis ' } },
          { type: 'emoji', data: { name: '😀' } },
          { type: 'text', data: { text: ' and ' } },
          { type: 'at', data: { user_id: 'user123', name: '@mentions' } }
        ],
        $sender: { id: 'user', name: 'User' },
        $reply: vi.fn(),
        $channel: { id: 'channel', type: 'group' },
        $timestamp: Date.now(),
        $raw: rawContent
      }

      expect(message.$raw).toBe(rawContent)
      expect(message.$raw).toContain('😀')
      expect(message.$raw).toContain('@mentions')
    })
  })
})
