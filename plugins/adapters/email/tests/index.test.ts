import { describe, it, expect } from 'vitest'

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

describe('EmailBot.htmlToText', () => {
  let htmlToText: (html: string) => string

  beforeAll(async () => {
    const { EmailBot } = await import('../src/bot')
    htmlToText = EmailBot.htmlToText
  })

  it('should strip simple HTML tags', () => {
    expect(htmlToText('<b>bold</b> and <i>italic</i>')).toBe('bold and italic')
  })

  it('should convert <br> to newline', () => {
    expect(htmlToText('line1<br>line2<br/>line3')).toBe('line1\nline2\nline3')
  })

  it('should convert block-level closing tags to newlines', () => {
    const html = '<p>paragraph1</p><p>paragraph2</p>'
    const result = htmlToText(html)
    expect(result).toContain('paragraph1')
    expect(result).toContain('paragraph2')
    expect(result.indexOf('paragraph1')).toBeLessThan(result.indexOf('paragraph2'))
  })

  it('should decode common HTML entities', () => {
    expect(htmlToText('a &amp; b &lt; c &gt; d &quot;e&quot; f&#39;s')).toBe('a & b < c > d "e" f\'s')
  })

  it('should decode numeric HTML entities', () => {
    expect(htmlToText('&#65;&#66;&#67;')).toBe('ABC')
  })

  it('should decode hex HTML entities', () => {
    expect(htmlToText('&#x41;&#x42;&#x43;')).toBe('ABC')
  })

  it('should strip <style> and <script> blocks', () => {
    const html = '<style>.foo{color:red}</style>hello<script>alert(1)</script>'
    expect(htmlToText(html)).toBe('hello')
  })

  it('should collapse excess whitespace', () => {
    expect(htmlToText('a    b     c')).toBe('a b c')
  })

  it('should collapse excess newlines', () => {
    expect(htmlToText('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('should return empty string for empty input', () => {
    expect(htmlToText('')).toBe('')
  })
})

describe('EmailBot.parseEmailContent', () => {
  let parseEmailContent: (email: any) => any[]

  beforeAll(async () => {
    const { EmailBot } = await import('../src/bot')
    parseEmailContent = EmailBot.parseEmailContent
  })

  it('should parse text-only email', () => {
    const email = { subject: 'Test', text: 'Hello World', html: '', attachments: [] }
    const segments = parseEmailContent(email)
    expect(segments).toHaveLength(2) // subject + text
    expect(segments[0].data.text).toContain('Test')
    expect(segments[1].data.text).toBe('Hello World')
  })

  it('should fallback to HTML when text is empty', () => {
    const email = { subject: '', text: '', html: '<p>HTML content</p>', attachments: [] }
    const segments = parseEmailContent(email)
    expect(segments.some((s: any) => s.data.text?.includes('HTML content'))).toBe(true)
  })

  it('should return empty message marker when no content', () => {
    const email = { subject: '', text: '', html: '', attachments: [] }
    const segments = parseEmailContent(email)
    expect(segments).toHaveLength(1)
    expect(segments[0].data.text).toBe('(Empty email)')
  })

  it('should handle image attachments', () => {
    const email = {
      subject: '', text: 'body', html: '',
      attachments: [{ filename: 'photo.jpg', contentType: 'image/jpeg', size: 1024 }]
    }
    const segments = parseEmailContent(email)
    expect(segments.some((s: any) => s.type === 'image')).toBe(true)
  })

  it('should handle non-image attachments as file segments', () => {
    const email = {
      subject: '', text: 'see attached', html: '',
      attachments: [{ filename: 'doc.pdf', contentType: 'application/pdf', size: 2048 }]
    }
    const segments = parseEmailContent(email)
    expect(segments.some((s: any) => s.type === 'file')).toBe(true)
  })
})
