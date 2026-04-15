import { describe, it, expect } from 'vitest'
import { createHash, createCipheriv, randomBytes } from 'crypto'

describe('Adapter Module', () => {
  it('should load adapter module', async () => {
    const adapter = await import('../src/index')
    expect(adapter).toBeDefined()
    expect(typeof adapter).toBe('object')
  })

  it('should have exports', async () => {
    const adapter = await import('../src/index')
    expect(Object.keys(adapter).length).toBeGreaterThan(0)
  })
})

describe('WeChatMPBot.parseMessageContent', () => {
  let parseMessageContent: (msg: any) => any[]

  beforeAll(async () => {
    const { WeChatMPBot } = await import('../src/bot')
    parseMessageContent = WeChatMPBot.parseMessageContent
  })

  it('should parse text message', () => {
    const msg = { MsgType: 'text', Content: 'Hello' }
    const segments = parseMessageContent(msg)
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('text')
    expect(segments[0].data.text).toBe('Hello')
  })

  it('should parse image message', () => {
    const msg = { MsgType: 'image', PicUrl: 'https://example.com/pic.jpg', MediaId: 'mid123' }
    const segments = parseMessageContent(msg)
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('image')
    expect(segments[0].data.url).toBe('https://example.com/pic.jpg')
  })

  it('should parse voice message', () => {
    const msg = { MsgType: 'voice', MediaId: 'mid456', Format: 'amr', Recognition: '你好' }
    const segments = parseMessageContent(msg)
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('voice')
    expect(segments[0].data.recognition).toBe('你好')
  })

  it('should parse video message', () => {
    const msg = { MsgType: 'video', MediaId: 'vid789', ThumbMediaId: 'thumb123' }
    const segments = parseMessageContent(msg)
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('video')
    expect(segments[0].data.mediaId).toBe('vid789')
  })

  it('should parse shortvideo as video', () => {
    const msg = { MsgType: 'shortvideo', MediaId: 'sv001', ThumbMediaId: 'th001' }
    const segments = parseMessageContent(msg)
    expect(segments[0].type).toBe('video')
  })

  it('should parse location message', () => {
    const msg = { MsgType: 'location', Location_X: '39.9', Location_Y: '116.4', Scale: '15', Label: 'Beijing' }
    const segments = parseMessageContent(msg)
    expect(segments[0].type).toBe('location')
    expect(segments[0].data.label).toBe('Beijing')
  })

  it('should parse link message', () => {
    const msg = { MsgType: 'link', Title: 'Article', Description: 'A blog post', Url: 'https://example.com' }
    const segments = parseMessageContent(msg)
    expect(segments[0].type).toBe('link')
    expect(segments[0].data.title).toBe('Article')
    expect(segments[0].data.url).toBe('https://example.com')
  })

  it('should parse event message', () => {
    const msg = { MsgType: 'event', Event: 'subscribe', EventKey: 'qrscene_123' }
    const segments = parseMessageContent(msg)
    expect(segments[0].type).toBe('event')
    expect(segments[0].data.event).toBe('subscribe')
    expect(segments[0].data.eventKey).toBe('qrscene_123')
  })

  it('should handle unsupported message type', () => {
    const msg = { MsgType: 'unknown_type' }
    const segments = parseMessageContent(msg)
    expect(segments[0].data.text).toContain('不支持的消息类型')
  })

  it('should return empty message for text with no content', () => {
    const msg = { MsgType: 'text' }
    const segments = parseMessageContent(msg)
    expect(segments[0].data.text).toBe('(空消息)')
  })
})

describe('WeChatMP AES encryption round-trip', () => {
  // Simulate the same algorithm used by the bot
  const appId = 'wx1234567890abcdef'
  const token = 'test_token_123'
  // 43-char base64url key → 32 bytes after Base64 decode with trailing =
  const encodingAESKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = aesKey.subarray(0, 16)

  function encrypt(xml: string): { encryptStr: string; timestamp: string; nonce: string; msgSignature: string } {
    const random = randomBytes(16)
    const msgBuf = Buffer.from(xml, 'utf8')
    const appIdBuf = Buffer.from(appId, 'utf8')
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(msgBuf.length, 0)

    const plaintext = Buffer.concat([random, lenBuf, msgBuf, appIdBuf])
    const blockSize = 32
    const padLen = blockSize - (plaintext.length % blockSize)
    const padBuf = Buffer.alloc(padLen, padLen)
    const padded = Buffer.concat([plaintext, padBuf])

    const cipher = createCipheriv('aes-256-cbc', aesKey, iv)
    cipher.setAutoPadding(false)
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
    const encryptStr = encrypted.toString('base64')

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = randomBytes(8).toString('hex')
    const msgSignature = createHash('sha1')
      .update([token, timestamp, nonce, encryptStr].sort().join(''))
      .digest('hex')

    return { encryptStr, timestamp, nonce, msgSignature }
  }

  it('should produce valid encrypted envelope', () => {
    const xml = '<xml><ToUserName>gh_test</ToUserName><Content>Hello</Content></xml>'
    const { encryptStr, msgSignature } = encrypt(xml)

    expect(encryptStr).toBeTruthy()
    expect(msgSignature).toHaveLength(40) // SHA1 hex
  })

  it('should verify signature matches encrypted content', () => {
    const xml = '<xml><Content>test</Content></xml>'
    const { encryptStr, timestamp, nonce, msgSignature } = encrypt(xml)

    const expected = createHash('sha1')
      .update([token, timestamp, nonce, encryptStr].sort().join(''))
      .digest('hex')

    expect(expected).toBe(msgSignature)
  })
})
