import { describe, it, expect, beforeEach, vi } from 'vitest'
import { jsx, jsxs, Fragment, renderJSX } from '../src/jsx'
import { Component, ComponentContext } from '../src/component'
import { MessageComponent } from '../src/message'

describe('JSX消息组件系统测试', () => {
  let mockContext: ComponentContext

  beforeEach(() => {
    mockContext = {
      event: {
        $id: 'test-msg',
        $adapter: 'test',
        $bot: 'test-bot',
        $content: [],
        $sender: { id: 'user123', name: 'testuser' },
        $reply: vi.fn().mockResolvedValue('reply123'),
        $channel: { id: 'channel123', type: 'group' },
        $timestamp: Date.now(),
        $raw: 'test message'
      }
    } as any
  })

  describe('JSX元素创建', () => {
    it('应该创建基础JSX元素', () => {
      const element = jsx('text', { children: 'Hello World' })
      
      expect(element).toEqual({
        type: 'text',
        data: { children: 'Hello World' }
      })
    })

    it('应该创建带属性的JSX元素', () => {
      const element = jsx('image', { 
        src: 'https://example.com/image.jpg',
        alt: '测试图片',
        children: null
      })
      
      expect(element).toEqual({
        type: 'image',
        data: { 
          src: 'https://example.com/image.jpg',
          alt: '测试图片',
          children: null
        }
      })
    })

    it('应该创建嵌套JSX元素', () => {
      const child = jsx('text', { children: '内容' })
      const parent = jsx('div', { children: [child] })
      
      expect(parent.data.children).toContain(child)
    })

    it('jsxs应该与jsx功能相同', () => {
      const element1 = jsx('text', { children: 'Hello' })
      const element2 = jsxs('text', { children: 'Hello' })
      
      expect(element1).toEqual(element2)
    })
  })

  describe('Fragment组件', () => {
    it('应该支持Fragment', () => {
      const fragment = jsx(Fragment, { 
        children: ['Hello', ' ', 'World'] 
      })
      
      expect(fragment.type).toBe(Fragment)
      expect(fragment.data.children).toEqual(['Hello', ' ', 'World'])
    })

    it('Fragment应该是函数类型', () => {
      expect(typeof Fragment).toBe('function')
      expect(Fragment.name).toBe('Fragment')
    })
  })

  describe('JSX渲染', () => {
    it('应该渲染纯文本元素', async () => {
      const element = jsx('text', { children: 'Hello World' })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('Hello World')
    })

    it('应该渲染Fragment', async () => {
      const fragment = jsx('Fragment', { 
        children: ['Hello', ' ', 'World'] 
      })
      const result = await renderJSX(fragment as MessageComponent<any>, mockContext)
      
      expect(result).toBe('Hello World')
    })

    it('应该渲染嵌套元素', async () => {
      const nested = jsx('div', {
        children: [
          jsx('text', { children: 'Hello' }),
          ' ',
          jsx('text', { children: 'World' })
        ]
      })
      const result = await renderJSX(nested as MessageComponent<any>, mockContext)
      
      expect(result).toBe('Hello World')
    })

    it('应该处理null和undefined子元素', async () => {
      const element = jsx('div', { 
        children: [null, undefined, 'Hello', null, 'World', undefined] 
      })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('HelloWorld')
    })

    it('应该处理数字和布尔值', async () => {
      const element = jsx('div', { 
        children: [42, true, false, 'text'] 
      })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('42truefalsetext')
    })
  })

  describe('函数组件', () => {
    it('应该渲染函数组件', async () => {
      const TestComponent: Component<{ name: string }> = async (props, context) => {
        return `Hello, ${props.name}!`
      }

      const element = jsx(TestComponent, { name: '用户' })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('Hello, 用户!')
    })

    it('应该向函数组件传递context', async () => {
      const ContextComponent: Component<{}> = async (props, context) => {
        return `Root: ${context?.root || 'No Root'}`
      }

      const element = jsx(ContextComponent, {})
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toContain('Root:')
    })

    it('应该处理异步函数组件', async () => {
      const AsyncComponent: Component<{ delay: number }> = async (props) => {
        await new Promise(resolve => setTimeout(resolve, props.delay))
        return 'Async content'
      }

      const element = jsx(AsyncComponent, { delay: 10 })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('Async content')
    })

    it('应该支持组件返回JSX元素', async () => {
      const WrapperComponent: Component<{ text: string }> = async (props) => {
        return `Wrapped: ${props.text}`
      }

      const element = jsx(WrapperComponent, { text: 'content' })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      // 由于函数组件返回字符串
      expect(result).toBe('Wrapped: content')
    })
  })

  describe('复杂渲染场景', () => {
    it('应该处理深度嵌套', async () => {
      const DeepComponent: Component<{ level: number }> = async (props) => {
        if (props.level <= 0) return `Level ${props.level}`
        return `Nested Level ${props.level}`
      }

      const element = jsx(DeepComponent, { level: 3 })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('Nested Level 3')
    })

    it('应该处理组件数组', async () => {
      const Item: Component<{ text: string }> = async (props) => `[${props.text}]`

      const items = ['A', 'B', 'C'].map(text => jsx(Item, { text }))
      const container = jsx('div', { children: items })
      
      const result = await renderJSX(container as MessageComponent<any>, mockContext)
      
      expect(result).toBe('[A][B][C]')
    })

    it('应该处理条件渲染', async () => {
      const ConditionalComponent: Component<{ show: boolean; text: string }> = async (props) => {
        return props.show ? props.text : ''
      }

      const element1 = jsx(ConditionalComponent, { show: true, text: 'Visible' })
      const element2 = jsx(ConditionalComponent, { show: false, text: 'Hidden' })
      
      const result1 = await renderJSX(element1 as MessageComponent<any>, mockContext)
      const result2 = await renderJSX(element2 as MessageComponent<any>, mockContext)
      
      expect(result1).toBe('Visible')
      expect(result2).toBe('')
    })
  })

  describe('错误处理', () => {
    it('应该捕获组件执行错误并返回错误消息', async () => {
      const ErrorComponent: Component<{}> = async () => {
        throw new Error('Component error')
      }

      const element = jsx(ErrorComponent, {})
      
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      expect(result).toBe('❌ 组件渲染失败: Component error')
    })

    it('应该处理无效的元素类型', async () => {
      const invalidElement = {
        type: 123 as any, // 无效类型
        data: { children: 'test' }
      }
      
      const result = await renderJSX(invalidElement as MessageComponent<any>, mockContext)
      expect(result).toMatch(/❌ 组件渲染失败/)
    })
    
    it('应该处理异步组件返回 Promise 的情况', async () => {
      const AsyncPromiseComponent: Component<{ text: string }> = async (props) => {
        // 返回一个 Promise（会被自动 await）
        return Promise.resolve(`Async: ${props.text}`)
      }

      const element = jsx(AsyncPromiseComponent, { text: 'test' })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('Async: test')
    })
    
    it('应该处理子组件为 Promise 的情况', async () => {
      const AsyncChild = Promise.resolve('Async Child Content')
      const element = jsx('div', { children: [AsyncChild] })
      
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      expect(result).toBe('Async Child Content')
    })
  })

  describe('性能和内存', () => {
    it('应该处理大量子元素', async () => {
      const manyChildren = Array.from({ length: 100 }, (_, i) => `Item ${i}`)
      const element = jsx('div', { children: manyChildren })
      
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toContain('Item 0')
      expect(result).toContain('Item 99')
      expect(typeof result).toBe('string')
    })

    it('应该正确处理空子元素数组', async () => {
      const element = jsx('div', { children: [] })
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('')
    })
  })

  describe('类型安全', () => {
    it('应该正确处理各种数据类型', async () => {
      const element = jsx('div', {
        children: [
          'string',
          42,
          true,
          false,
          null,
          undefined,
          jsx('span', { children: 'nested' })
        ]
      })
      
      const result = await renderJSX(element as MessageComponent<any>, mockContext)
      
      expect(result).toBe('string42truefalsenested')
    })

    it('应该保持属性数据完整性', () => {
      const props = {
        id: 'test-id',
        className: 'test-class',
        onClick: () => {},
        data: { key: 'value' },
        children: 'content'
      }
      
      const element = jsx('button', props)
      
      expect(element.data).toEqual(props)
      expect(element.data.id).toBe('test-id')
      expect(element.data.className).toBe('test-class')
      expect(typeof element.data.onClick).toBe('function')
    })
  })
})