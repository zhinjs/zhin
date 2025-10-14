# 文档错误报告

## 🔍 核查结果

基于实际代码验证，发现以下文档错误：

## ❌ 主要错误

### 1. Web 控制台端口错误（高优先级）

**实际情况：**
- HTTP 插件默认端口：`8086`
- 代码位置：`plugins/http/src/index.ts:509`
```typescript
port: Number((process.env.port ||= '8086'))
```

**错误的文档：**

#### docs/guide/quick-start.md
- ❌ 第 43 行：`http://localhost:3000`
- ✅ 应为：`http://localhost:8086`

#### docs/index.md  
- ❌ 第 156 行：`http://localhost:3000`
- ✅ 应为：`http://localhost:8086`

#### docs/guide/getting-started.md
- ❌ 第 197 行：`http://localhost:3000`
- ✅ 应为：`http://localhost:8086`

#### docs/official/plugins.md
- ❌ 第 216 行：`http://localhost:3000/console`
- ✅ 应为：`http://localhost:8086`
- ❌ 第 666 行、701 行、711 行：多处 `port: 3000`
- ✅ 应为：`port: 8086`
- ❌ 第 782 行：`curl http://localhost:3000/console`
- ✅ 应为：`curl http://localhost:8086`

---

### 2. CLI 生成代码中缺少 roll 命令

**实际情况：**
- CLI 生成的插件示例只包含 `hello` 和 `status` 命令
- 代码位置：`packages/cli/src/commands/init.ts:278-296`

**问题的文档：**

#### docs/guide/quick-start.md
- ❌ 第 35 行：提到 `roll 20` 命令
- ❌ 第 164-168 行：包含 roll 命令代码
- ⚠️ 这是文档中的扩展示例，但与 CLI 生成的代码不一致

#### docs/guide/getting-started.md
- ❌ 第 315-320 行：包含 roll 命令代码
- ❌ 第 356、359 行：测试 roll 命令
- ⚠️ 同样是扩展示例，但应明确说明这不是 CLI 生成的

#### docs/guide/your-first-bot.md
- 第 50-66 行：roll 命令示例
- 第 342-346 行：roll 命令完整示例
- ⚠️ 这个文件是教学文档，包含 roll 命令是合理的

---

### 3. 配置示例中的端口不一致

**实际情况：**
- 默认端口：8086
- 可通过环境变量 `port` 修改

**错误的文档：**

#### docs/guide/configuration.md
- ❌ 第 157 行：`port: 3000`
- ✅ 应为：`port: 8086` 或说明这是自定义配置

#### docs/official/adapters.md
- ❌ 第 276 行：`port: 3000`
- ✅ 应为：`port: 8086`

---

## 📋 详细修复清单

### 需要修改的文件（按优先级）

#### 🔴 高优先级（端口错误）

1. **docs/guide/quick-start.md**
   - 第 43 行：`localhost:3000` → `localhost:8086`

2. **docs/index.md**
   - 第 156 行：`localhost:3000` → `localhost:8086`

3. **docs/guide/installation.md**
   - ✅ 已正确使用 8086

4. **docs/guide/getting-started.md**
   - 第 197 行：`localhost:3000` → `localhost:8086`

5. **docs/official/plugins.md**
   - 第 216 行：`localhost:3000/console` → `localhost:8086`
   - 第 666 行：`port: 3000` → `port: 8086`
   - 第 701 行：`port: 3000` → `port: 8086`
   - 第 711 行：`port: 3001` → `port: 8087`（如果是第二个实例）
   - 第 773 行：`HTTP_PORT=3001` → `HTTP_PORT=8087`
   - 第 782 行：`localhost:3000` → `localhost:8086`

6. **docs/guide/configuration.md**
   - 第 157 行：添加说明这是自定义端口示例

7. **docs/official/adapters.md**
   - 第 276 行：`port: 3000` → `port: 8086`

#### 🟡 中优先级（roll 命令一致性）

8. **docs/guide/quick-start.md**
   - 第 35 行：移除 `roll 20` 示例，或添加说明
   - 第 164-168 行：添加注释说明这是扩展示例

9. **docs/guide/getting-started.md**
   - 第 315-320 行：添加说明这是扩展示例
   - 第 356、359 行：添加说明需要先添加 roll 命令

#### 🟢 低优先级（文档完善）

10. **docs/guide/your-first-bot.md**
    - ✅ 作为教学文档，roll 命令示例是合理的
    - 建议：添加说明这是新增的命令

---

## 🔍 验证方法

### 1. 端口验证
```bash
# 查看实际端口
grep -r "port.*8086\|port.*3000" plugins/http/src/

# 结果：默认端口是 8086
```

### 2. CLI 生成验证
```bash
# 创建测试项目
npm create zhin-app test-docs -- --yes
cd test-docs

# 查看生成的插件
cat src/plugins/test-plugin.ts

# 结果：只有 hello 和 status 命令，没有 roll
```

### 3. 运行验证
```bash
pnpm install
pnpm dev

# 在控制台查看启动日志
# [INFO] server is running at http://0.0.0.0:8086
```

---

## 💡 建议

### 1. 统一端口使用

**推荐做法：**
```markdown
访问 Web 控制台：`http://localhost:8086`（默认端口，可通过环境变量 `port` 修改）
```

**环境变量说明：**
```bash
# .env
port=8086  # HTTP 服务端口（默认 8086）
```

### 2. CLI 生成代码一致性

**选项 A：在文档中明确说明**
```markdown
> **注意：** 以下 `roll` 命令不在 CLI 生成的代码中，是一个学习示例。
> 你可以将其添加到你的插件中。
```

**选项 B：更新 CLI 生成代码，添加 roll 命令**
```typescript
// 在 packages/cli/src/commands/init.ts 中添加
addCommand(new MessageCommand('roll [sides:number=6]')
  .action(async (message, result) => {
    const sides = result.params.sides || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    return `🎲 你掷出了 ${roll} 点！（${sides} 面骰子）`;
  })
);
```

**推荐：** 选项 A，在文档中添加说明，保持 CLI 生成的代码简洁。

### 3. 文档编写规范

为避免此类错误，建议：

1. **配置统一管理**
   - 在文档中使用环境变量引用
   - 明确默认值

2. **代码示例验证**
   - 所有代码示例应该能运行
   - 与 CLI 生成的代码保持一致
   - 扩展示例应明确标注

3. **定期验证**
   - 每次代码更新后验证文档
   - 自动化测试文档中的代码示例

---

## 📊 统计

| 类别 | 错误数量 | 影响范围 |
|------|---------|----------|
| 端口错误 | 11 处 | 6 个文件 |
| 命令一致性 | 6 处 | 3 个文件 |
| 总计 | 17 处 | 7 个文件 |

---

## 🎯 修复优先级

### 立即修复（影响使用）
- ✅ 所有端口从 3000 改为 8086

### 近期修复（影响学习体验）
- ⚠️ roll 命令一致性说明

### 后续优化（提升质量）
- 📝 建立文档验证流程
- 📝 添加自动化测试

---

**报告生成时间：** 2025-01-14
**验证范围：** docs 目录所有文档
**验证方法：** 对比实际代码 + grep 搜索
**问题严重程度：** 中等（不影响功能，但会困扰用户）

