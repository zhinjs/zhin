import { MessageSegment, Message, MessageSender, MessageChannel, SendContent } from '../src/types'

// 创建测试消息片段
export function createTestMessageSegment(type: string, data: Record<string, any>): MessageSegment {
  return { type, data }
}

// 创建测试消息发送者
export function createTestSender(id: string, name?: string): MessageSender {
  return { id, name }
}

// 创建测试消息频道
export function createTestChannel(id: string, type: 'group' | 'private' | 'channel'): MessageChannel {
  return { id, type }
}

// 创建测试消息
export function createTestMessage(
  id: string,
  content: MessageSegment[],
  sender: MessageSender,
  channel: MessageChannel,
  raw: string = '',
  timestamp: number = Date.now()
): Message {
  return {
    id,
    content,
    sender,
    channel,
    raw,
    timestamp,
    reply: async (content: SendContent, quote?: boolean | string) => {
      // 模拟回复功能
    }
  }
}

// 等待指定时间
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 创建测试错误
export class TestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TestError'
  }
}

// 创建测试日志记录器
export const TestLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
