# 高级特性

深入了解 Zhin.js 的高级功能。

## 组件系统

使用组件复用消息模板：

```typescript
const UserCard = defineComponent((props) => {
  return `用户: ${props.name}`
}, 'UserCard')

addComponent(UserCard)
```

[了解更多 →](./components)

## 定时任务

使用 Cron 创建定时任务：

```typescript
const cron = inject('cron')

cron.add(new Cron('0 8 * * *', () => {
  console.log('早上好！')
}))
```

[了解更多 →](./cron)

## 数据库

使用数据库存储数据：

```typescript
useContext('database', (db) => {
  db.define('users', {
    id: { type: 'integer', primary: true },
    name: { type: 'string' }
  })
})
```

[了解更多 →](./database)

## 热重载

代码修改自动生效，无需重启：

- ✅ 插件代码修改
- ✅ 配置文件修改
- ✅ 依赖关系自动管理

[了解更多 →](./hot-reload)

