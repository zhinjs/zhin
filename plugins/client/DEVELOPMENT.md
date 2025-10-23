# Zhin Client 开发文档

## 目录
- [架构概述](#架构概述)
- [插件配置系统](#插件配置系统)
- [Schema 类型支持](#schema-类型支持)
- [组件架构](#组件架构)
- [API 参考](#api-参考)
- [开发指南](#开发指南)

## 架构概述

Zhin Client 是一个基于 React Router 7.0 和 Redux 的现代化前端应用，主要包含两大核心系统：

1. **动态路由系统** - 支持运行时动态添加/删除/更新页面路由
2. **插件配置系统** - 基于 Schema 的自动化配置表单生成

### 技术栈

- **React 19.2** - UI 框架
- **React Router 7.0** - 路由管理
- **Redux Toolkit** - 状态管理
- **Radix UI Themes** - UI 组件库
- **TypeScript 5.3+** - 类型系统
- **Vite** - 构建工具

## 插件配置系统

### 核心特性

1. **Schema 驱动** - 基于 Zhin.js Schema 系统自动生成表单
2. **15 种数据类型** - 完整支持所有 Schema 类型
3. **智能 UI 组件** - 根据类型自动选择最佳控件
4. **嵌套结构** - 支持任意深度的对象/数组嵌套
5. **实时验证** - 输入时进行类型验证
6. **紧凑布局** - ScrollArea + Accordion 优化空间

### 使用示例

```tsx
import PluginConfigForm from '@zhin.js/client/components/PluginConfigForm'
import { Dialog } from '@radix-ui/themes'

<Dialog.Root open={configOpen} onOpenChange={setConfigOpen}>
  <Dialog.Content style={{ maxWidth: 600 }}>
    <Dialog.Title>配置插件</Dialog.Title>
    <Dialog.Description>修改插件配置</Dialog.Description>
    
    <PluginConfigForm
      pluginName="my-plugin"
      onClose={() => setConfigOpen(false)}
      onSuccess={() => refetchPlugin()}
    />
  </Dialog.Content>
</Dialog.Root>
```

## Schema 类型支持

### 完整类型列表 (15/15)

#### 1. 基础类型

##### `string` - 字符串
```typescript
Schema.string('username').description('用户名')
Schema.string('bio').description('多行个人简介')  // 多行文本
Schema.string('role').enum(['admin', 'user'])    // 下拉选择
```

**UI 控件**:
- 枚举值 → Select 下拉
- 多行 → TextArea
- 单行 → TextField

##### `number` / `integer` - 数字
```typescript
Schema.number('age').min(0).max(120)
Schema.number('price').step(0.01)
```

**UI 控件**: TextField (type="number")

##### `boolean` - 布尔值
```typescript
Schema.boolean('enabled').default(true)
```

**UI 控件**: Switch 开关 + 状态文字

#### 2. 特殊类型

##### `percent` - 百分比
```typescript
Schema.percent('opacity').default(0.8)
```

**UI 控件**: Range 滑块 + 数字输入（0-100%）

##### `date` - 日期
```typescript
Schema.date('birthDate')
```

**UI 控件**: 原生日期选择器

##### `regexp` - 正则表达式
```typescript
Schema.regexp('pattern').description('匹配模式')
```

**UI 控件**: TextField (monospace) + 格式提示

##### `const` - 常量
```typescript
Schema.const('v1.0.0', 'version')
```

**UI 控件**: Badge 只读显示

#### 3. 集合类型

##### `list` - 列表
```typescript
// 简单列表
Schema.list(Schema.string(), 'tags')

// 复杂列表
Schema.list(Schema.object({
  name: Schema.string(),
  age: Schema.number()
}), 'users')
```

**UI 控件**:
- 简单类型 → TextArea (每行一个值)
- 复杂类型 → Card 列表 + 添加/删除按钮

##### `tuple` - 元组
```typescript
Schema.tuple([
  Schema.string('name'),
  Schema.number('age'),
  Schema.boolean('active')
])
```

**UI 控件**: 固定字段列表，每个字段独立类型

##### `object` - 对象
```typescript
Schema.object({
  host: Schema.string().required(),
  port: Schema.number().default(3000),
  ssl: Schema.boolean().default(false)
})
```

**UI 控件**: Card 容器 + 嵌套字段

##### `dict` - 字典
```typescript
Schema.dict(Schema.number(), 'scores')
```

**UI 控件**: JSON 编辑器 (TextArea)

#### 4. 组合类型

##### `union` - 联合类型
```typescript
Schema.union([
  Schema.const('auto'),
  Schema.const('manual'),
  Schema.number()
])
```

**UI 控件**: Select 下拉选择

##### `intersect` - 交叉类型
```typescript
Schema.intersect([
  Schema.object({ name: Schema.string() }),
  Schema.object({ age: Schema.number() })
])
```

**UI 控件**: Card + 多条件输入

#### 5. 通用类型

##### `any` - 任意类型
```typescript
Schema.any('metadata')
```

**UI 控件**: JSON 编辑器，支持所有 JSON 类型

##### `never` - 永不类型
```typescript
Schema.never()
```

**UI 控件**: 警告 Callout（提示不应配置）

### 字段元数据

所有类型均支持以下元数据：

| 属性 | 说明 | 示例 |
|------|------|------|
| `key` | 字段标识 | `'username'` |
| `type` | 类型名称 | `'string'` |
| `description` | 描述信息 | `'请输入用户名'` |
| `default` | 默认值 | `'admin'` |
| `required` | 是否必填 | `true` |
| `min` / `max` | 数值范围 | `min(0).max(100)` |
| `step` | 步进值 | `0.01` |
| `enum` | 枚举选项 | `['a', 'b', 'c']` |
| `pattern` | 正则模式 | `'^[a-z]+$'` |

### 完整配置示例

```typescript
import { Schema } from 'zhin.js'

export const config = Schema.object({
  // === 基础类型 ===
  name: Schema.string('插件名称')
    .required()
    .description('插件的显示名称'),
  
  version: Schema.const('1.0.0', 'version'),
  
  enabled: Schema.boolean('是否启用')
    .default(true),
  
  // === 特殊类型 ===
  opacity: Schema.percent('透明度')
    .default(0.8)
    .description('UI 透明度'),
  
  startDate: Schema.date('开始日期'),
  
  pattern: Schema.regexp('匹配模式')
    .description('日志匹配规则'),
  
  // === 集合类型 ===
  tags: Schema.list(Schema.string(), '标签')
    .description('插件标签，每行一个'),
  
  coordinates: Schema.tuple([
    Schema.number('x坐标'),
    Schema.number('y坐标')
  ]),
  
  server: Schema.object({
    host: Schema.string('主机地址')
      .default('localhost'),
    port: Schema.number('端口')
      .min(1)
      .max(65535)
      .default(3000),
    ssl: Schema.boolean('启用SSL')
      .default(false)
  }),
  
  // === 组合类型 ===
  mode: Schema.union([
    Schema.const('auto'),
    Schema.const('manual')
  ]).description('运行模式'),
  
  // === 通用类型 ===
  metadata: Schema.any('元数据')
    .description('自定义元数据，JSON 格式')
})
```

### 字段分组策略

配置表单会自动将字段分为两组：

**简单字段** (直接展示):
- string, number, boolean
- percent, date, regexp, const, never

**复杂字段** (Accordion 折叠):
- object, dict
- list, tuple
- union, intersect, any

## 组件架构

### PluginConfigForm 模块结构

```
components/PluginConfigForm/
├── types.ts                        45 行 - 类型定义
├── BasicFieldRenderers.tsx        206 行 - 9个基础渲染器
├── CollectionFieldRenderers.tsx   199 行 - 5个集合渲染器
├── CompositeFieldRenderers.tsx     79 行 - 2个组合渲染器
├── FieldRenderer.tsx              115 行 - 分发路由
├── NestedFieldRenderer.tsx         95 行 - 嵌套渲染
└── index.tsx                      302 行 - 主组件
```

### 组件职责

#### 1. BasicFieldRenderers.tsx
**职责**: 渲染基础数据类型

**导出组件** (9个):
- `StringFieldRenderer`
- `NumberFieldRenderer`
- `BooleanFieldRenderer`
- `PercentFieldRenderer`
- `DateFieldRenderer`
- `RegexpFieldRenderer`
- `ConstFieldRenderer`
- `NeverFieldRenderer`
- `AnyFieldRenderer`

#### 2. CollectionFieldRenderers.tsx
**职责**: 渲染集合/容器类型

**导出组件** (5个):
- `ListFieldRenderer` - 支持简单/复杂列表
- `ArrayFieldRenderer` - 兼容旧格式
- `TupleFieldRenderer` - 固定字段列表
- `ObjectFieldRenderer` - 嵌套对象
- `DictFieldRenderer` - JSON 字典

#### 3. CompositeFieldRenderers.tsx
**职责**: 渲染组合类型

**导出组件** (2个):
- `UnionFieldRenderer` - 联合类型选择
- `IntersectFieldRenderer` - 交叉类型

#### 4. NestedFieldRenderer.tsx
**职责**: 渲染嵌套字段（数组项、元组项）

**特点**:
- 简化版字段渲染器
- 支持递归调用
- 专用于嵌套场景

#### 5. FieldRenderer.tsx
**职责**: 字段渲染器主入口

**核心功能**:
```typescript
export function FieldRenderer(props: FieldRendererConfig) {
  const { field } = props
  
  switch (field.type) {
    case 'string': return <StringFieldRenderer {...props} />
    case 'number': return <NumberFieldRenderer {...props} />
    // ... 15 种类型的分发
    default: return <DefaultJSONEditor {...props} />
  }
}

export function isComplexField(field: SchemaField): boolean {
  return ['object', 'list', 'tuple', 'union', 'intersect', 'any'].includes(field.type)
}
```

#### 6. index.tsx
**职责**: 主组件逻辑编排

**核心功能**:
- 数据获取 (`fetchSchemaAndConfig`)
- 状态管理 (`useState`)
- 事件处理 (`handleFieldChange`, `handleNestedFieldChange`, `handleArrayItemChange`)
- 字段分组和渲染
- UI 布局（ScrollArea, Accordion）

**状态流**:
```
用户操作 → onChange → handleXXXChange → setConfig → 重新渲染
```

### 数据流

```
1. 组件挂载
   ├─ fetchSchemaAndConfig()
   ├─ GET /api/schemas/:name
   ├─ GET /api/config/:name
   └─ setSchema + setConfig

2. 用户编辑
   ├─ 用户修改字段
   ├─ onChange 回调
   ├─ handleFieldChange / handleNestedFieldChange / handleArrayItemChange
   └─ setConfig (更新状态)

3. 保存配置
   ├─ handleSave()
   ├─ POST /api/config/:name
   └─ onSuccess() → onClose()
```

## API 参考

### PluginConfigForm Props

```typescript
interface PluginConfigFormProps {
  pluginName: string      // 插件名称
  onClose: () => void     // 关闭回调
  onSuccess?: () => void  // 成功回调
}
```

### HTTP API

#### 获取 Schema
```http
GET /api/schemas/:pluginName
Authorization: Basic admin:123456

Response:
{
  "success": true,
  "data": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "插件名称",
        "required": true
      }
    }
  }
}
```

#### 获取配置
```http
GET /api/config/:pluginName
Authorization: Basic admin:123456

Response:
{
  "success": true,
  "data": {
    "name": "my-plugin",
    "enabled": true
  }
}
```

#### 保存配置
```http
POST /api/config/:pluginName
Authorization: Basic admin:123456
Content-Type: application/json

Body:
{
  "name": "my-plugin",
  "enabled": true
}

Response:
{
  "success": true
}
```

## 开发指南

### 添加新的字段类型

1. 在 `BasicFieldRenderers.tsx` 中创建渲染器：

```typescript
export function MyTypeFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div>
      {/* 你的 UI 实现 */}
    </div>
  )
}
```

2. 在 `FieldRenderer.tsx` 中注册：

```typescript
export function FieldRenderer(props: FieldRendererConfig) {
  switch (props.field.type) {
    // ... 其他类型
    case 'mytype':
      return <MyTypeFieldRenderer {...props} />
  }
}
```

3. 更新 `isComplexField()` (如果是复杂类型):

```typescript
export function isComplexField(field: SchemaField): boolean {
  return ['object', 'list', 'tuple', 'union', 'intersect', 'any', 'mytype'].includes(field.type)
}
```

### 单元测试

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { StringFieldRenderer } from './BasicFieldRenderers'

describe('StringFieldRenderer', () => {
  it('renders text input', () => {
    const onChange = vi.fn()
    
    render(
      <StringFieldRenderer
        fieldName="username"
        field={{ type: 'string' }}
        value="test"
        onChange={onChange}
      />
    )
    
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new value' } })
    
    expect(onChange).toHaveBeenCalledWith('new value')
  })
})
```

### 性能优化

1. **使用 React.memo**:
```typescript
export const StringFieldRenderer = React.memo(({ field, value, onChange }: FieldRendererProps) => {
  // ...
})
```

2. **使用 useCallback**:
```typescript
const handleFieldChange = useCallback((fieldName: string, value: any) => {
  setConfig(prev => ({ ...prev, [fieldName]: value }))
}, [])
```

3. **懒加载复杂字段**:
```typescript
const ComplexField = lazy(() => import('./ComplexField'))
```

### 调试技巧

1. **查看 Schema 结构**:
```typescript
console.log('Schema:', JSON.stringify(schema, null, 2))
```

2. **监听配置变化**:
```typescript
useEffect(() => {
  console.log('Config changed:', config)
}, [config])
```

3. **使用 React DevTools**:
   - 查看组件树
   - 监控 Props 变化
   - 分析渲染性能

## 最佳实践

### 1. Schema 定义

✅ **推荐**:
```typescript
Schema.string('username')
  .required()
  .description('用户登录名，3-20个字符')
  .pattern('^[a-zA-Z0-9_]{3,20}$')
```

❌ **不推荐**:
```typescript
Schema.string()  // 缺少描述和验证
```

### 2. 默认值

✅ **推荐**:
```typescript
Schema.boolean('enabled').default(true)
Schema.number('port').default(3000)
```

❌ **不推荐**:
```typescript
Schema.boolean('enabled')  // 没有默认值，可能导致 undefined
```

### 3. 嵌套结构

✅ **推荐**:
```typescript
Schema.object({
  server: Schema.object({
    host: Schema.string().default('localhost'),
    port: Schema.number().default(3000)
  })
})
```

❌ **不推荐**:
```typescript
Schema.object({
  'server.host': Schema.string(),  // 扁平化键名
  'server.port': Schema.number()
})
```

### 4. 枚举值

✅ **推荐**:
```typescript
Schema.union([
  Schema.const('development'),
  Schema.const('production'),
  Schema.const('test')
]).description('运行环境')
```

❌ **不推荐**:
```typescript
Schema.string().enum(['dev', 'prod', 'test'])  // 缺少清晰的含义
```

## 故障排查

### 常见问题

#### 1. 配置未保存

**症状**: 点击保存后配置未生效

**排查**:
```typescript
// 检查 API 响应
console.log('Save response:', await response.json())

// 检查配置值
console.log('Current config:', config)
```

**解决**: 确保 Schema 定义与后端一致

#### 2. 字段不显示

**症状**: 某些字段没有在表单中显示

**排查**:
```typescript
// 检查 fields
console.log('Fields:', Object.keys(fields))

// 检查 Schema 格式
console.log('Schema:', schema)
```

**解决**: 确保 Schema 使用 `properties` 或 `dict` 格式

#### 3. 嵌套字段无法编辑

**症状**: 嵌套对象的字段无法修改

**排查**:
```typescript
// 检查 onChange 是否正确传递
<ObjectFieldRenderer
  renderField={(fn, f, pp) => {
    console.log('Rendering nested:', fn, pp)
    return renderField(fn, f, pp)
  }}
/>
```

**解决**: 确保 `handleNestedFieldChange` 正确实现

## 更新日志

### v1.1.0 (2024-10-22)

**新增**:
- ✨ 完整支持 15 种 Schema 类型
- ✨ 模块化组件架构（17 个独立渲染器）
- ✨ 智能字段分组（简单/复杂字段）
- ✨ 紧凑布局优化（ScrollArea + Accordion）

**改进**:
- 🎨 统一组件尺寸（size="1"）
- 📝 完善类型定义和注释
- ⚡ 优化渲染性能

**修复**:
- 🐛 Schema 格式兼容性问题（dict vs properties）
- 🐛 嵌套字段状态管理问题

## 参考资源

- [Zhin.js 文档](https://zhin.js.org)
- [Radix UI Themes](https://www.radix-ui.com/themes)
- [React Router 7.0](https://reactrouter.com)
- [Redux Toolkit](https://redux-toolkit.js.org)

## 贡献指南

欢迎提交 Issue 和 Pull Request！

开发流程：
1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 许可证

MIT License
