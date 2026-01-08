# 组件系统

组件用于复用消息模板。

## 定义组件

```typescript
import { usePlugin, defineComponent } from 'zhin.js'

const { addComponent } = usePlugin()

// 函数式组件
const MyComponent = defineComponent((props, context) => {
  return `Hello, ${props.name}!`
}, 'MyComponent')

addComponent(MyComponent)
```

## 使用组件

```typescript
// 在消息中使用
addCommand(
  new MessageCommand('greet <name:string>')
    .action((_, result) => {
      return `<MyComponent name="${result.params.name}"/>`
    })
)
```

## 组件上下文

```typescript
const MyComponent = defineComponent((props, context) => {
  // 访问父组件
  console.log(context.parent)
  
  // 访问子组件内容
  console.log(context.children)
  
  // 渲染子模板
  return context.render('<OtherComponent/>')
}, 'MyComponent')
```

## 完整示例

```typescript
import { usePlugin, defineComponent } from 'zhin.js'

const { addComponent, addCommand } = usePlugin()

// 用户卡片组件
const UserCard = defineComponent((props) => {
  return [
    `用户: ${props.name}`,
    `等级: ${props.level}`,
    `积分: ${props.points}`
  ].join('\n')
}, 'UserCard')

addComponent(UserCard)

// 使用组件
addCommand(
  new MessageCommand('profile')
    .action(() => {
      return '<UserCard name="Alice" level="10" points="1000"/>'
    })
)
```

