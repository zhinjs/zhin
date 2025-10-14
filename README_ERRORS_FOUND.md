# README 错误发现报告

基于 test-bot 的实际使用情况，发现以下模块 README 存在错误：

## 📋 发现的错误

### 1. @zhin.js/core README

**文件**: `packages/core/README.md`

#### 错误 1: 数据库配置字段错误
- **位置**: 第 48-51 行
- **错误内容**:
```typescript
database: {
  dialect: 'sqlite',
  storage: './data/bot.db'  // ❌ 错误
}
```
- **实际应为**:
```typescript
database: {
  dialect: 'sqlite',
  filename: './data/bot.db'  // ✅ 正确
}
```
- **依据**: test-bot/zhin.config.ts 第 6-9 行使用 `filename`

---

### 2. @zhin.js/http README

**文件**: `plugins/http/README.md`

#### 错误 1: 环境变量名称大小写错误
- **位置**: 第 36、46-54 行
- **错误内容**:
```env
# HTTP 服务器端口
PORT=8086  # ❌ 错误

# 路由前缀
routerPrefix=/api  # ❌ 可能错误

# Basic Auth 认证
username=admin  # ✅ 正确
password=123456  # ✅ 正确
```
- **实际应为**:
```env
# HTTP 服务器端口
port=8086  # ✅ 正确（小写）

# 路由前缀
routerPrefix=/api  # 需要验证

# Basic Auth 认证
username=admin  # ✅ 正确
password=123456  # ✅ 正确
```
- **依据**: plugins/http/src/index.ts 第 509 行使用 `process.env.port`（小写）

---

## 🔍 需要进一步验证的内容

### 1. @zhin.js/adapter-icqq README

需要对比实际配置项：
- test-bot 使用: `log_level: 'off'`, `platform: 4`, `sign_api_addr`
- README 需要确认这些字段是否正确记录

### 2. @zhin.js/adapter-qq README

需要检查：
- test-bot 使用的配置项: `appid`, `secret`, `intents`, `logLevel`, `mode`, `removeAt`, `sandbox`
- 需要确认 README 是否包含这些字段

### 3. @zhin.js/adapter-kook README

需要检查：
- test-bot 使用的配置项: `token`, `mode`, `logLevel`, `ignore`

---

## ✅ 验证通过的内容

### test-bot 的实际使用验证

1. **插件加载顺序** - test-bot 遵循正确的加载顺序:
   ```typescript
   plugins: [
     'http',           // 先加载 HTTP
     'adapter-process',
     'adapter-icqq',
     'adapter-onebot11',
     'adapter-qq',
     'console',        // 后加载 Console
     'adapter-kook',
     // 自定义插件
   ]
   ```

2. **数据库使用** - test-bot 正确使用:
   - `defineModel` 定义模型
   - `onDatabaseReady` 监听数据库就绪
   - `db.model()` 获取模型

3. **Message API** - test-bot 正确使用:
   - `message.$sender.id`
   - `message.$bot`
   - `message.$raw` (未在示例中直接使用，但应该使用)

4. **组件系统** - test-bot 正确使用:
   - `addComponent` 注册组件
   - `defineComponent` 定义组件
   - JSX 语法

5. **Prompt 系统** - test-bot 正确使用:
   - `usePrompt(message)` 创建 prompt
   - `prompt.pick()` 选择器

---

## 🎯 修复优先级

### 高优先级（会导致代码无法运行）
1. ✅ @zhin.js/core - `storage` → `filename`
2. ✅ @zhin.js/http - `PORT` → `port`

### 中优先级（配置说明不完整）
3. ⚠️ @zhin.js/adapter-icqq - 补充实际使用的配置项
4. ⚠️ @zhin.js/adapter-qq - 补充实际使用的配置项
5. ⚠️ @zhin.js/adapter-kook - 补充实际使用的配置项

---

**报告生成时间**: 2025-10-14
**验证方法**: 对比 test-bot 实际代码
**验证范围**: 所有模块 README

