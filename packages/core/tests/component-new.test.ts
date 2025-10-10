import { describe, it, expect, beforeEach, vi } from 'vitest'
import { 
  defineComponent, 
  createComponentContext, 
  renderComponents, 
  getProps,
  Component,
  ComponentContext,
  Fragment,
  Fetch
} from '../src/component'
import { Message } from '../src/message'
import { SendOptions } from '../src/types'

// Mock utils functions
vi.mock('../src/utils', () => ({
  getValueWithRuntime: vi.fn((expression, context) => {
    // Simple mock implementation for testing
    if (typeof expression === 'string' && context) {
      // Handle simple variable access
      if (expression in context) {
        return context[expression]
      }
      // Handle object property access like 'user.name'
      if (expression.includes('.')) {
        const [obj, prop] = expression.split('.')
        return context[obj]?.[prop]
      }
      // Handle simple expressions
      try {
        return eval(expression)
      } catch {
        return expression
      }
    }
    return expression
  }),
  compiler: vi.fn((template, context) => template),
  segment: {
    toString: vi.fn((content) => typeof content === 'string' ? content : JSON.stringify(content)),
    from: vi.fn((content) => content),
    escape: vi.fn((content) => content.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
  }
}))

describe('函数式组件系统测试', () => {
  let mockContext: ComponentContext
  let mockMessage: Message

  beforeEach(() => {
    mockMessage = {
      $id: '1',
      $adapter: 'test',
      $bot: 'test-bot',
      $content: [],
      $sender: { id: 'user1', name: 'User' },
      $reply: vi.fn(),
      $channel: { id: 'channel1', type: 'private' },
      $timestamp: Date.now(),
      $raw: 'test'
    }

    mockContext = createComponentContext(
      { user: { name: 'John', age: 25 } },
      undefined,
      'test template'
    )
  })

  describe('defineComponent 函数测试', () => {
    it('应该正确创建函数式组件', () => {
      const TestComponent = defineComponent(async function TestComponent(props: { name: string }, context: ComponentContext) {
        return `Hello ${props.name}`
      }, 'test-component')

      expect(TestComponent).toBeInstanceOf(Function)
      expect(TestComponent.name).toBe('test-component')
    })

    it('应该支持异步组件', async () => {
      const AsyncComponent = defineComponent(async function AsyncComponent(props: { delay: number }, context: ComponentContext) {
        await new Promise(resolve => setTimeout(resolve, props.delay))
        return `Delayed: ${props.delay}ms`
      }, 'async-component')

      const result = await AsyncComponent({ delay: 10 }, mockContext)
      expect(result).toBe('Delayed: 10ms')
    })
  })

  describe('getProps 函数测试', () => {
    it('应该正确解析简单属性', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test name="John" age={25} active={true} />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.name).toBe('John')
      expect(props.age).toBe(25)
      expect(props.active).toBe(true)
    })

    it('应该正确解析表达式属性', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test sum={1+1} max={Math.max(1,2,3)} />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.sum).toBe(2)
      // 现在 Math.max 表达式求值应该工作了
      expect(props.max).toBe(3)
    })

    it('应该正确处理 kebab-case 到 camelCase 转换', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test user-name="John" user-age={25} is-active={true} />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.userName).toBe('John')
      expect(props.userAge).toBe(25)
      expect(props.isActive).toBe(true)
    })

    it('应该正确处理 children 属性', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test>Hello World</test>'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.children).toBe('Hello World')
    })

    it('应该正确处理自闭合标签', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test name="John" />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.name).toBe('John')
      expect(props.children).toBeUndefined()
    })
  })

  describe('createComponentContext 函数测试', () => {
    it('应该正确创建组件上下文', () => {
      const context = createComponentContext(
        { user: { name: 'John' } },
        undefined,
        'test template'
      )

      expect(context.props).toEqual({ user: { name: 'John' } })
      expect(context.root).toBe('test template')
      expect(context.parent).toBeUndefined()
      expect(context.children).toBeUndefined()
      expect(typeof context.render).toBe('function')
      expect(typeof context.getValue).toBe('function')
      expect(typeof context.compile).toBe('function')
    })

    it('应该正确处理父上下文', () => {
      const parentContext = createComponentContext({ parent: 'data' })
      const childContext = createComponentContext(
        { child: 'data' },
        parentContext,
        'child template'
      )

      expect(childContext.parent).toBe(parentContext)
      expect(childContext.props).toEqual({ child: 'data' })
    })
  })

  describe('内置组件测试', () => {
    it('Fragment 组件应该正确渲染 children', async () => {
      const result = await Fragment({ children: 'Hello World' }, mockContext)
      expect(result).toBe('Hello World')
    })

    it('Fetch 组件应该正确获取远程内容', async () => {
      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve('Remote content')
      })

      const result = await Fetch({ url: 'https://example.com' }, mockContext)
      expect(result).toBe('Remote content')
    })
  })

  describe('renderComponents 函数测试', () => {
    it('应该正确渲染单个组件', async () => {
      const TestComponent = defineComponent(async function TestComponent(props: { name: string }, context: ComponentContext) {
        return `Hello ${props.name}`
      }, 'test')

      const componentMap = new Map([['test', TestComponent]])
      const options: SendOptions = {
        content: '<test name="John" />',
        type: 'text',
        context: 'test',
        bot: 'test'
      }

      const result = await renderComponents(componentMap, options)
      expect(result.content).toContain('Hello John')
    })

    it('应该正确渲染多个组件', async () => {
      const Component1 = defineComponent(async function Component1(props: { text: string }, context: ComponentContext) {
        return `[${props.text}]`
      }, 'comp1')

      const Component2 = defineComponent(async function Component2(props: { number: number }, context: ComponentContext) {
        return `{${props.number}}`
      }, 'comp2')

      const componentMap = new Map([
        ['comp1', Component1],
        ['comp2', Component2]
      ])

      const options: SendOptions = {
        content: '<comp1 text="Hello" /> <comp2 number={42} />',
        type: 'text',
        context: 'test',
        bot: 'test'
      }

      const result = await renderComponents(componentMap, options)
      expect(result.content).toContain('[Hello]')
      expect(result.content).toContain('{42}')
    })

    it('应该正确处理嵌套组件', async () => {
      const OuterComponent = defineComponent(async function OuterComponent(props: { title: string }, context: ComponentContext) {
        return `标题: ${props.title}`
      }, 'outer')

      const InnerComponent = defineComponent(async function InnerComponent(props: { content: string }, context: ComponentContext) {
        return `Content: ${props.content}`
      }, 'inner')

      const componentMap = new Map([
        ['outer', OuterComponent],
        ['inner', InnerComponent]
      ])

      const options: SendOptions = {
        content: '<outer title="Test"><inner content="Nested" /></outer>',
        type: 'text',
        context: 'test',
        bot: 'test'
      }

      const result = await renderComponents(componentMap, options)
      // 现在嵌套组件渲染应该工作了
      expect(result.content).toContain('标题: Test')
    })
  })

  describe('表达式求值测试', () => {
    it('应该正确计算数学表达式', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test sum={1+2+3} product={2*3*4} />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.sum).toBe(6)
      expect(props.product).toBe(24)
    })

    it('应该正确处理比较表达式', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test greater={5>3} equal={2==2} />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.greater).toBe(true)
      expect(props.equal).toBe(true)
    })

    it('应该正确处理三元运算符', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test result={5>3 ? "yes" : "no"} />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.result).toBe('yes')
    })

    it('应该正确处理数组和对象表达式', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = '<test items={[1,2,3]} config={{name:"test",value:42}} />'
      const props = getProps(TestComponent, template, mockContext)

      expect(props.items).toEqual([1, 2, 3])
      expect(props.config).toEqual({ name: 'test', value: 42 })
    })
  })

  describe('错误处理测试', () => {
    it('应该正确处理无效的组件模板', () => {
      const TestComponent = defineComponent(async function TestComponent(props: any, context: ComponentContext) {
        return 'test'
      }, 'test')

      const template = 'invalid template'
      const props = getProps(TestComponent, template, mockContext)

      expect(props).toEqual({})
    })

    it('应该正确处理组件渲染错误', async () => {
      const ErrorComponent = defineComponent(async function ErrorComponent(props: any, context: ComponentContext) {
        throw new Error('Test error')
      }, 'error')

      const componentMap = new Map([['error', ErrorComponent]])
      const options: SendOptions = {
        content: '<error />',
        type: 'text',
        context: 'test',
        bot: 'test'
      }

      await expect(renderComponents(componentMap, options)).rejects.toThrow('Test error')
    })
  })
})
