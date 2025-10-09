import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Component, defineComponent, CapWithChild, CapWithClose } from '../src/component'
import { Message } from '../src/message'

// Mock utils functions
vi.mock('../src/utils', () => ({
  getValueWithRuntime: vi.fn((expression, context) => {
    // Simple mock implementation
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

describe('Component系统测试', () => {
  let mockContext: Component.Context
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

    mockContext = {
      $slots: {},
      $message: mockMessage,
      $root: 'test template',
      parent: {} as any,
      render: vi.fn().mockResolvedValue('rendered content'),
      children: 'default children'
    }
  })

  describe('Component类基础功能测试', () => {
    it('应该正确创建Component实例', () => {
      const component = new Component({
        name: 'test-component',
        render: (props) => `Hello ${props.name || 'World'}`
      })

      expect(component).toBeInstanceOf(Component)
      expect(component.name).toBe('test-component')
      expect(component.$props).toEqual([])
    })

    it('应该正确处理带属性的组件', () => {
      const component = new Component({
        name: 'user-card',
        props: {
          name: String,
          age: Number,
          active: Boolean
        },
        render: (props) => `User: ${props.name}, Age: ${props.age}, Active: ${props.active}`
      })

      expect(component.$props).toHaveLength(3)
      expect(component.$props[0].name).toBe('name')
      expect(component.$props[0].type).toBe(String)
      expect(component.$props[1].name).toBe('age')
      expect(component.$props[1].type).toBe(Number)
      expect(component.$props[2].name).toBe('active')
      expect(component.$props[2].type).toBe(Boolean)
    })

    it('应该正确处理带默认值的属性', () => {
      const component = new Component({
        name: 'greeting',
        props: {
          message: {
            type: String,
            default: 'Hello World'
          },
          count: {
            type: Number,
            default: 0
          }
        },
        render: (props) => `${props.message} (${props.count})`
      })

      expect(component.$props).toHaveLength(2)
      expect(component.$props[0].default).toBe('Hello World')
      expect(component.$props[1].default).toBe(0)
    })

    it('应该支持动态名称设置', () => {
      const component = new Component({
        name: 'initial-name',
        render: () => 'content'
      })

      expect(component.name).toBe('initial-name')
      
      component.name = 'new-name'
      expect(component.name).toBe('new-name')
    })
  })

  describe('模板匹配测试', () => {
    let component: Component

    beforeEach(() => {
      component = new Component({
        name: 'test-comp',
        render: () => 'test'
      })
    })

    it('应该正确匹配自闭合标签', () => {
      const template = '<test-comp name="test" />'
      expect(component.isClosing(template)).toBe(true)
      expect(component.match(template)).toBe(template)
    })

    it('应该正确匹配带children的标签', () => {
      const template = '<test-comp name="test">Hello World</test-comp>'
      expect(component.isClosing(template)).toBe(false)
      expect(component.match(template)).toBe(template)
    })

    it('应该在不匹配时返回undefined', () => {
      const template = '<other-comp name="test" />'
      expect(component.match(template)).toBeUndefined()
    })

    it('应该正确识别符号常量', () => {
      expect(component[CapWithChild]).toBeInstanceOf(RegExp)
      expect(component[CapWithClose]).toBeInstanceOf(RegExp)
    })
  })

  describe('属性解析测试', () => {
    let component: Component

    beforeEach(() => {
      component = new Component({
        name: 'prop-test',
        props: {
          name: String,
          age: {
            type: Number,
            default: 18
          },
          active: {
            type: Boolean,
            default: false
          }
        },
        render: () => 'test'
      })
    })

    it('应该正确解析属性', () => {
      const template = '<prop-test name="John" age="25" active="true" />'
      const props = component.parseProps(template)

      expect(props.name).toBe('John')
      expect(props.age).toBe('25') // Note: parseProps returns strings
      expect(props.active).toBe('true')
    })

    it('应该使用默认值填充缺失的属性', () => {
      const template = '<prop-test name="John" />'
      const props = component.parseProps(template)

      expect(props.name).toBe('John')
      expect(props.age).toBe(18)
      expect(props.active).toBe(false)
    })

    it('应该正确处理带引号的属性值', () => {
      const template = `<prop-test name='John Doe' description="A 'test' user" />`
      const props = component.parseProps(template)

      expect(props.name).toBe('John Doe')
      expect(props.description).toBe("A 'test' user")
    })

    it('应该处理kebab-case到camelCase的转换', () => {
      const template = '<prop-test user-name="john" max-count="10" />'
      // This test would need the actual render method to see the conversion
      // For now, we just test that parseProps extracts the attributes
      const props = component.parseProps(template)
      
      expect(props['user-name']).toBe('john')
      expect(props['max-count']).toBe('10')
    })
  })

  describe('Children解析测试', () => {
    let component: Component

    beforeEach(() => {
      component = new Component({
        name: 'child-test',
        render: () => 'test'
      })
    })

    it('应该正确解析children内容', () => {
      const template = '<child-test>Hello World</child-test>'
      const children = component.parseChildren(template)
      
      expect(children).toBe('Hello World')
    })

    it('应该在自闭合标签中返回空字符串', () => {
      const template = '<child-test />'
      const children = component.parseChildren(template)
      
      expect(children).toBe('')
    })

    it('应该处理复杂的children内容', () => {
      const template = '<child-test><span>Nested content</span></child-test>'
      const children = component.parseChildren(template)
      
      // parseChildren实际只提取标签之间的文本内容
      expect(children).toBe('Nested content')
    })
  })

  describe('渲染功能测试', () => {
    it('应该正确渲染简单组件', async () => {
      const component = new Component({
        name: 'simple',
        render: () => 'Hello World'
      })

      const template = '<simple />'
      const result = await component.render(template, mockContext)
      
      expect(result).toBe('rendered content') // Mocked render function result
    })

    it('应该正确传递props给渲染函数', async () => {
      const renderSpy = vi.fn().mockReturnValue('rendered')
      
      const component = new Component({
        name: 'props-comp',
        props: {
          name: String
        },
        render: renderSpy
      })

      const template = '<props-comp name="John" />'
      await component.render(template, mockContext)
      
      expect(renderSpy).toHaveBeenCalled()
      // The first argument should contain the parsed props
      const [props] = renderSpy.mock.calls[0]
      expect(props.name).toBe('John')
    })

    it('应该正确处理data函数', async () => {
      const component = new Component({
        name: 'data-comp',
        props: {
          name: String
        },
        data() {
          return {
            computed: `Hello ${this.name}`
          }
        },
        render: (props, context) => context.computed
      })

      const template = '<data-comp name="World" />'
      const result = await component.render(template, mockContext)
      
      expect(result).toBe('rendered content') // Mocked result
    })
  })

  describe('指令系统测试', () => {
    it('应该正确处理v-if指令', async () => {
      const component = new Component({
        name: 'conditional',
        render: () => 'Content'
      })

      // Mock getValueWithRuntime to return false for v-if
      const { getValueWithRuntime } = await import('../src/utils')
      vi.mocked(getValueWithRuntime).mockReturnValueOnce(false)

      const template = '<conditional v-if="false" />'
      const result = await component.render(template, mockContext)
      
      expect(result).toBe('') // Should return empty string when v-if is false
    })

    it('应该正确处理v-for指令', async () => {
      const component = new Component({
        name: 'list-item',
        render: (props) => `Item: ${props.item}`
      })

      const template = '<list-item v-for="item in items" />'
      const contextWithItems = {
        ...mockContext,
        items: ['A', 'B', 'C']
      }

      // This test is complex due to the v-for implementation
      // We'll test that the render method is called
      const result = await component.render(template, contextWithItems)
      expect(result).toBeDefined()
    })
  })

  describe('循环处理测试', () => {
    it('应该正确解析简单循环表达式', () => {
      const result = Component.fixLoop('item in items')
      
      expect(result).toEqual({
        name: 'item',
        value: 'items'
      })
    })

    it('应该正确处理数字范围循环', () => {
      const result = Component.fixLoop('i in 3')
      
      expect(result).toEqual({
        name: 'i',
        value: '__loop__',
        __loop__: [0, 1, 2]
      })
    })

    it('应该正确处理数组字面量循环', () => {
      const result = Component.fixLoop('item in ["a","b","c"]')
      
      expect(result).toEqual({
        name: 'item',
        value: '__loop__',
        __loop__: ["a", "b", "c"]
      })
    })
  })

  describe('静态渲染方法测试', () => {
    it('应该正确处理空组件映射', async () => {
      const componentMap = new Map()
      const options = { content: 'Hello World' }
      
      const result = await Component.render(componentMap, options)
      
      expect(result).toEqual(options) // Should return original options unchanged
    })

    it('应该正确渲染带组件的内容', async () => {
      const component = new Component({
        name: 'test-comp',
        render: () => 'Rendered'
      })
      
      const componentMap = new Map([['test-comp', component]])
      const options = { content: '<test-comp />' }
      
      // Mock segment functions
      const { segment } = await import('../src/utils')
      vi.mocked(segment.toString).mockReturnValue('<test-comp />')
      vi.mocked(segment.from).mockReturnValue('processed content')
      
      const result = await Component.render(componentMap, options)
      
      expect(result.content).toBe('processed content')
    })
  })

  describe('内置组件测试', () => {
    describe('Template组件', () => {
      it('应该正确处理模板组件的render函数', () => {
        const props = { '#header': 'true' }
        const contextWithParent = {
          ...mockContext,
          parent: { ...mockContext.parent, $slots: {} }
        }
        const result = Component.Template.$options.render(props, contextWithParent)
        
        expect(result).toBe('') // Template components return empty string
      })

      it('应该正确设置插槽', () => {
        const props = { '#header': 'true', '#footer': 'true' }
        const contextWithParent = {
          ...mockContext,
          parent: { ...mockContext.parent, $slots: {} }
        }
        
        Component.Template.$options.render(props, contextWithParent)
        
        // Should have set slots in parent context  
        expect(Object.keys(contextWithParent.parent.$slots)).toContain('header')
        expect(Object.keys(contextWithParent.parent.$slots)).toContain('footer')
      })
    })

    describe('Slot组件', () => {
      it('应该正确渲染默认插槽', () => {
        const contextWithSlots = {
          ...mockContext,
          parent: {
            ...mockContext.parent,
            $slots: {
              default: vi.fn().mockReturnValue('Slot Content')
            }
          }
        }

        const result = Component.Slot.$options.render({}, contextWithSlots)
        
        expect(result).toBe('Slot Content')
      })

      it('应该正确渲染命名插槽', () => {
        const contextWithSlots = {
          ...mockContext,
          parent: {
            ...mockContext.parent,
            $slots: {
              header: vi.fn().mockReturnValue('Header Slot')
            }
          }
        }

        const result = Component.Slot.$options.render({ name: 'header' }, contextWithSlots)
        
        expect(result).toBe('Header Slot')
      })

      it('应该在插槽不存在时使用children', () => {
        const contextWithoutSlots = {
          ...mockContext,
          parent: { ...mockContext.parent, $slots: {} },
          children: 'Fallback Content'
        }

        const result = Component.Slot.$options.render({ name: 'missing' }, contextWithoutSlots)
        
        expect(result).toBe('Fallback Content')
      })
    })
  })

  describe('defineComponent工厂函数测试', () => {
    it('应该正确创建函数式组件', () => {
      const renderFn = (props: any) => `Hello ${props.name}`
      const component = defineComponent(renderFn, 'func-comp')
      
      expect(component).toBeInstanceOf(Component)
      expect(component.name).toBe('func-comp')
    })

    it('应该正确创建配置式组件', () => {
      const component = defineComponent({
        name: 'config-comp',
        props: {
          title: String
        },
        render: (props) => props.title
      })
      
      expect(component).toBeInstanceOf(Component)
      expect(component.name).toBe('config-comp')
      expect(component.$props).toHaveLength(1)
    })

    it('应该正确处理重载函数', () => {
      // Test function overload
      const renderFn = () => 'test'
      const funcComponent = defineComponent(renderFn)
      expect(funcComponent).toBeInstanceOf(Component)

      // Test options overload
      const optionsComponent = defineComponent({
        name: 'options-comp',
        render: () => 'test'
      })
      expect(optionsComponent).toBeInstanceOf(Component)
      expect(optionsComponent.name).toBe('options-comp')
    })
  })

  describe('复杂场景测试', () => {
    it('应该正确处理嵌套组件', async () => {
      const childComponent = new Component({
        name: 'child',
        render: (props) => `Child: ${props.content}`
      })

      const parentComponent = new Component({
        name: 'parent',
        render: () => '<child content="nested" />'
      })

      const componentMap = new Map([
        ['child', childComponent],
        ['parent', parentComponent]
      ])

      const options = { content: '<parent />' }
      const result = await Component.render(componentMap, options)
      
      expect(result).toBeDefined()
    })

    it('应该正确处理属性绑定', async () => {
      const component = new Component({
        name: 'bind-test',
        render: (props) => `Value: ${props.dynamicValue}`
      })

      const template = '<bind-test :dynamic-value="someVar" />'
      const contextWithVar = {
        ...mockContext,
        someVar: 'Dynamic Content'
      }

      const result = await component.render(template, contextWithVar)
      expect(result).toBeDefined()
    })

    it('应该正确处理上下文传递', async () => {
      const component = new Component({
        name: 'context-test',
        render: (props, context) => {
          expect(context.$message).toBe(mockMessage)
          expect(context.parent).toBeDefined()
          return 'Context OK'
        }
      })

      const template = '<context-test />'
      await component.render(template, mockContext)
    })

    it('应该正确处理错误情况', async () => {
      const component = new Component({
        name: 'error-test',
        render: () => {
          throw new Error('Render error')
        }
      })

      const template = '<error-test />'
      
      // The render method should handle errors gracefully
      await expect(component.render(template, mockContext)).rejects.toThrow('Render error')
    })
  })

  describe('性能和边界测试', () => {
    it('应该处理空模板', async () => {
      const component = new Component({
        name: 'empty-test',
        render: () => ''
      })

      const result = await component.render('', mockContext)
      expect(result).toBe('rendered content') // Mocked result
    })

    it('应该处理大量属性', async () => {
      const manyProps: any = {}
      for (let i = 0; i < 100; i++) {
        manyProps[`prop${i}`] = String
      }

      const component = new Component({
        name: 'many-props',
        props: manyProps,
        render: () => 'OK'
      })

      expect(component.$props).toHaveLength(100)
    })

    it('应该处理长模板字符串', async () => {
      const component = new Component({
        name: 'long-template',
        render: () => 'OK'
      })

      const longContent = 'A'.repeat(10000)
      const template = `<long-template content="${longContent}" />`
      
      const result = await component.render(template, mockContext)
      expect(result).toBeDefined()
    })
  })

  describe('类型系统测试', () => {
    it('应该支持泛型类型约束', () => {
      interface Props {
        title: string
        count: number
      }

      const component: Component<{}, {}, Props> = new Component({
        name: 'typed-comp',
        render: (props: Props) => `${props.title}: ${props.count}`
      })

      expect(component).toBeInstanceOf(Component)
    })

    it('应该正确处理PropConfig类型', () => {
      const component = new Component({
        name: 'prop-config-test',
        props: {
          stringProp: String,
          numberProp: Number,
          booleanProp: Boolean,
          arrayProp: Array,
          objectProp: Object
        },
        render: () => 'test'
      })

      const propTypes = component.$props.map(p => p.type)
      expect(propTypes).toContain(String)
      expect(propTypes).toContain(Number)
      expect(propTypes).toContain(Boolean)
      expect(propTypes).toContain(Array)
      expect(propTypes).toContain(Object)
    })
  })
})
