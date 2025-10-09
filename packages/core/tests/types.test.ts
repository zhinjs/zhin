import { describe, it, expect } from 'vitest'
import {
  createTestMessageSegment,
  createTestSender,
  createTestChannel,
  createTestMessage
} from './test-utils'
import type {
  MessageSegment,
  Message,
  MessageSender,
  MessageChannel,
  User,
  Group,
  BotConfig,
  AppConfig,
  SendOptions
} from '../src/types'

describe('消息片段类型测试', () => {
  it('应该正确创建文本消息片段', () => {
    const segment: MessageSegment = createTestMessageSegment('text', { content: '测试消息' })
    expect(segment.type).toBe('text')
    expect(segment.data).toEqual({ content: '测试消息' })
  })

  it('应该正确创建图片消息片段', () => {
    const segment: MessageSegment = createTestMessageSegment('image', { url: 'http://example.com/image.jpg' })
    expect(segment.type).toBe('image')
    expect(segment.data).toEqual({ url: 'http://example.com/image.jpg' })
  })
})

describe('消息发送者类型测试', () => {
  it('应该正确创建消息发送者', () => {
    const sender: MessageSender = createTestSender('123', '测试用户')
    expect(sender.id).toBe('123')
    expect(sender.name).toBe('测试用户')
  })

  it('应该允许创建没有名称的发送者', () => {
    const sender: MessageSender = createTestSender('123')
    expect(sender.id).toBe('123')
    expect(sender.name).toBeUndefined()
  })
})

describe('消息频道类型测试', () => {
  it('应该正确创建群组频道', () => {
    const channel: MessageChannel = createTestChannel('123', 'group')
    expect(channel.id).toBe('123')
    expect(channel.type).toBe('group')
  })

  it('应该正确创建私聊频道', () => {
    const channel: MessageChannel = createTestChannel('123', 'private')
    expect(channel.id).toBe('123')
    expect(channel.type).toBe('private')
  })
})

describe('消息类型测试', () => {
  it('应该正确创建完整的消息对象', async () => {
    const sender = createTestSender('123', '测试用户')
    const channel = createTestChannel('456', 'group')
    const content = [
      createTestMessageSegment('text', { content: '测试消息' })
    ]
    const message: Message = createTestMessage('789', content, sender, channel, '原始消息')

    expect(message.id).toBe('789')
    expect(message.content).toEqual(content)
    expect(message.sender).toEqual(sender)
    expect(message.channel).toEqual(channel)
    expect(message.raw).toBe('原始消息')
    expect(message.timestamp).toBeDefined()
    expect(typeof message.reply).toBe('function')

    // 测试回复功能
    await expect(message.reply('测试回复')).resolves.toBeUndefined()
  })
})

describe('用户类型测试', () => {
  it('应该正确定义用户属性', () => {
    const user: User = {
      user_id: '123',
      nickname: '测试用户',
      card: '群名片',
      role: '管理员'
    }
    expect(user.user_id).toBe('123')
    expect(user.nickname).toBe('测试用户')
    expect(user.card).toBe('群名片')
    expect(user.role).toBe('管理员')
  })
})

describe('群组类型测试', () => {
  it('应该正确定义群组属性', () => {
    const group: Group = {
      group_id: '123',
      group_name: '测试群组',
      member_count: 100
    }
    expect(group.group_id).toBe('123')
    expect(group.group_name).toBe('测试群组')
    expect(group.member_count).toBe(100)
  })
})

describe('机器人配置类型测试', () => {
  it('应该正确定义机器人配置', () => {
    const config: BotConfig = {
      name: '测试机器人',
      context: 'test',
      platform: 'qq',
      token: '123456'
    }
    expect(config.name).toBe('测试机器人')
    expect(config.context).toBe('test')
    expect(config.platform).toBe('qq')
    expect(config.token).toBe('123456')
  })
})

describe('应用配置类型测试', () => {
  it('应该正确定义应用配置', () => {
    const config: AppConfig = {
      bots: [{
        name: '测试机器人',
        context: 'test'
      }],
      plugin_dirs: ['./plugins'],
      plugins: ['test-plugin'],
      disable_dependencies: ['disabled-plugin'],
      debug: true
    }
    expect(config.bots).toHaveLength(1)
    expect(config.plugin_dirs).toEqual(['./plugins'])
    expect(config.plugins).toEqual(['test-plugin'])
    expect(config.disable_dependencies).toEqual(['disabled-plugin'])
    expect(config.debug).toBe(true)
  })
})

describe('发送选项类型测试', () => {
  it('应该正确定义发送选项', () => {
    const options: SendOptions = {
      id: '123',
      type: 'group',
      context: 'test',
      bot: 'test-bot',
      content: '测试消息'
    }
    expect(options.id).toBe('123')
    expect(options.type).toBe('group')
    expect(options.context).toBe('test')
    expect(options.bot).toBe('test-bot')
    expect(options.content).toBe('测试消息')
  })
})
