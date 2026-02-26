---
name: skill-creator
description: 创建或更新 AgentSkills 技能。当需要设计技能结构、编写 SKILL.md、配置工具关联或整理技能资源时使用。支持中英文。
keywords: ["skill", "技能", "SKILL.md", "创建技能", "技能开发"]
tags: ["development", "skill-creation", "documentation"]
---

# Skill Creator - 技能创建指南

此技能提供创建高质量 AgentSkills 的完整指导。

## 关于技能（Skills）

技能是模块化的、自包含的能力包，通过提供专业知识、工作流程和工具集成来扩展 Agent 能力。可以把它们想象成特定领域或任务的"新手引导"。

### 技能提供什么

1. **专业工作流** - 特定领域的多步骤流程
2. **工具集成** - 特定文件格式或 API 的使用说明
3. **领域专长** - 公司特定知识、数据结构、业务逻辑
4. **打包资源** - 复杂和重复任务的脚本、参考文档和资源

## 核心原则

- **简洁为王**：指导模型「做什么」，而非「如何做 AI」
- **安全第一**：如果技能使用 `exec` 工具，确保提示词不允许从不可信输入注入任意命令
- **本地测试**：使用 Agent 测试技能，验证 AI 理解和执行是否符合预期
- **上下文感知**：技能只在被激活后才加载完整内容，因此 description 要足够清晰
- **用户友好**：使用清晰的语言，提供实际示例

## SKILL.md 剖析

每个 SKILL.md 文件由两部分组成：

### 1. Frontmatter（YAML 头部）

```yaml
---
name: skill-name               # 技能名称（必填，kebab-case）
description: 技能描述字符串      # 技能描述（必填，清晰说明用途和使用场景）
keywords:                      # 触发关键词（可选，帮助 AI 匹配用户意图）
  - keyword1
  - 关键词2
tags:                          # 分类标签（可选，用于技能分组）
  - category
  - domain
tools:                         # 关联的工具名称列表（可选）
  - tool_name_1
  - tool_name_2
compatibility:                 # 兼容性要求（可选）
  os: [darwin, linux]          # 支持的操作系统
  deps: [git, node]            # 必需的系统依赖
---
```

**重要字段说明**：

- **name** 和 **description** 是唯一必填字段，Agent 仅根据这两个字段决定是否激活技能
- **description** 要**全面且清晰**，因为 AI 根据它判断技能相关性
- **keywords** 帮助提高匹配准确度，应包含用户可能使用的词汇
- **tools** 声明技能关联的工具，系统会自动查找并关联
- **compatibility** 用于跨平台技能，避免在不兼容环境中激活

### 2. Body（Markdown 正文）

正文包含技能的完整指令和指导，只有在 Agent 调用 `activate_skill` 工具后才会加载。

**推荐结构**：

```markdown
# 技能名称

简要说明技能用途。

## 使用场景

- 场景 1：描述
- 场景 2：描述

## 工作流程

### 步骤 1：标题

详细描述第一步操作...

### 步骤 2：标题

详细描述第二步操作...

## 工具使用

### tool_name_1

调用方式、参数说明、注意事项...

### tool_name_2

调用方式、参数说明、注意事项...

## 示例

### 示例 1：标题

完整的实际用例...

### 示例 2：标题

另一个用例...

## 注意事项

- 注意事项 1
- 注意事项 2

## 常见问题

Q：问题 1？
A：回答 1...
```

## 技能创建步骤

### 步骤 1：确定技能范围

**思考问题**：
- 这个技能解决什么问题？
- 谁会使用它？在什么场景下？
- 需要哪些工具支持？
- 是否需要特定平台或依赖？

### 步骤 2：创建技能目录

```bash
# 在项目根目录
mkdir -p skills/your-skill-name

# 或在 data 目录（用户自定义技能）
mkdir -p data/skills/your-skill-name
```

### 步骤 3：编写 SKILL.md

1. **编写 Frontmatter**：
   - name：使用 kebab-case（如 `database-migration`）
   - description：2-3 句话清晰说明技能用途和触发条件
   - keywords：列出 5-10 个相关词汇（中英文）
   - tools：列出需要的工具名称

2. **编写正文**：
   - 清晰的章节结构
   - 详细的步骤说明
   - 实际可运行的示例
   - 边界情况和异常处理

### 步骤 4：测试技能

1. **发现测试**：确保技能被系统发现
   ```
   用户：@AI 有哪些技能？
   AI：（应列出你的技能）
   ```

2. **激活测试**：验证技能能被正确激活
   ```
   用户：（使用技能相关关键词提问）
   AI：（应激活技能并按指令执行）
   ```

3. **执行测试**：测试完整工作流
   ```
   用户：（提出实际任务）
   AI：（按技能指导执行，调用相关工具）
   ```

### 步骤 5：迭代优化

根据实际使用反馈：
- 调整 description 提高匹配准确度
- 补充 keywords 覆盖更多用户表达
- 优化指令清晰度和可操作性
- 添加更多边界情况处理

## 最佳实践

### Description 编写技巧

✅ **好的 description**：
```yaml
description: 数据库迁移工具。当需要创建、应用或回滚数据库迁移时使用。支持 SQLite、MySQL 和 PostgreSQL。
```

❌ **不好的 description**：
```yaml
description: 数据库相关操作
```

**原则**：
- 说明「做什么」（功能）和「何时用」（场景）
- 列出支持的具体类型/平台
- 使用用户可能使用的自然语言

### 工具关联

**方式 1：在 frontmatter 中声明**（推荐）
```yaml
tools:
  - file_read
  - file_write
  - shell_exec
```

**方式 2：在插件中同时注册工具和技能**
```typescript
// 注册工具
addTool(new ZhinTool('my_tool')...);

// 声明技能（自动关联该插件的工具）
declareSkill({
  description: '...',
  keywords: ['...'],
});
```

### 多文件技能

对于复杂技能，可以创建子目录结构：

```
skills/your-skill/
├── SKILL.md           # 主技能文件
├── examples/          # 示例文件
│   ├── example1.md
│   └── example2.md
├── scripts/           # 辅助脚本
│   └── helper.sh
└── references/        # 参考文档
    └── api-spec.md
```

在 SKILL.md 中可以引用这些文件：
```markdown
## 示例

参见 `examples/example1.md` 了解完整用例。

## 辅助脚本

使用 `scripts/helper.sh` 进行...
```

### 安全考虑

如果技能使用 `shell_exec` 或文件操作工具：

1. **验证输入**：明确指示 AI 验证用户输入
2. **限制范围**：指定允许的操作范围（如特定目录）
3. **确认机制**：对高风险操作要求用户确认
4. **错误处理**：提供清晰的错误恢复指导

**示例**：
```markdown
## 安全要求

- 仅在项目目录内操作，不得访问 `/etc`、`/usr` 等系统目录
- 执行任何删除操作前，必须先向用户确认
- 如遇权限错误，提示用户手动执行
```

## 技能分类建议

按用途分类：

- **development** - 开发工具（代码生成、重构、测试）
- **documentation** - 文档相关（生成、更新、翻译）
- **data-processing** - 数据处理（转换、清洗、分析）
- **automation** - 自动化（CI/CD、部署、监控）
- **research** - 研究辅助（搜索、总结、引用）
- **creative** - 创意工作（写作、设计、头脑风暴）

## 示例：完整的技能文件

```markdown
---
name: code-reviewer
description: 代码审查助手。当需要审查代码质量、发现潜在问题、提供改进建议时使用。支持 TypeScript、JavaScript、Python。
keywords:
  - code review
  - 代码审查
  - 审查代码
  - 检查代码
  - code quality
tags:
  - development
  - code-quality
tools:
  - file_read
  - grep_search
  - semantic_search
compatibility:
  deps: [node, git]
---

# Code Reviewer - 代码审查助手

自动审查代码质量、发现潜在问题并提供改进建议。

## 使用场景

- 提交前代码自查
- Pull Request 审查
- 重构前代码评估
- 新人代码指导

## 审查流程

### 步骤 1：理解上下文

1. 使用 `file_read` 读取目标文件
2. 使用 `grep_search` 查找相关文件（imports, dependencies）
3. 理解代码在项目中的角色

### 步骤 2：多维度检查

#### 代码质量
- 命名是否清晰语义化
- 函数是否单一职责
- 是否有重复代码
- 注释是否充分

#### 潜在问题
- 空指针/undefined 检查
- 异常处理是否完善
- 资源是否正确释放
- 并发安全性

#### 最佳实践
- 是否符合项目规范
- 是否使用了合适的设计模式
- 是否考虑了性能优化
- 是否有足够的测试覆盖

### 步骤 3：生成报告

按以下格式输出：

```markdown
## 审查结果：文件名

### ✅ 优点
- 优点 1
- 优点 2

### ⚠️ 改进建议
- 建议 1（优先级：高/中/低）
- 建议 2

### 🐛 潜在问题
- 问题 1（代码行号）
- 问题 2

### 📝 代码示例
\`\`\`diff
- bad code
+ good code
\`\`\`
```

## 示例

### 示例 1：函数审查

**用户**：审查 `src/utils/helper.ts` 中的数据处理函数

**执行步骤**：
1. `file_read` 读取文件
2. 分析函数逻辑、参数验证、错误处理
3. 检查类型安全性
4. 生成审查报告

### 示例 2：组件审查

**用户**：检查 React 组件是否符合最佳实践

**执行步骤**：
1. `file_read` 读取组件文件
2. 检查 hooks 使用、性能优化、可访问性
3. 验证 props 类型定义
4. 提供重构建议

## 注意事项

- 保持客观，既指出问题也肯定优点
- 建议要具体可操作，附带代码示例
- 考虑项目上下文，不强求完美
- 优先关注功能正确性和安全性

## 审查清单

复制以下清单确保不遗漏：

- [ ] 命名清晰语义化
- [ ] 函数长度适中（< 50 行）
- [ ] 参数数量合理（< 5 个）
 [ ] 错误处理完善
- [ ] 类型定义准确
- [ ] 无重复代码
- [ ] 注释充分但不冗余
- [ ] 无明显性能问题
- [ ] 安全性考虑（XSS, SQL 注入等）
- [ ] 测试覆盖关键路径
```

## 常见问题

**Q：技能多长合适？**
A：没有硬性限制，但建议正文控制在 500-2000 行。太短无法提供足够指导，太长影响 AI 理解。复杂流程可以分拆成多个技能。

**Q：技能何时被激活？**
A：Agent 根据 `description` 和 `keywords` 判断技能相关性。用户消息匹配度高时自动调用 `activate_skill` 加载完整内容。

**Q：可以在技能中调用其他技能吗？**
A：不直接支持，但可以在技能指令中建议 Agent "如需 XX 功能，先激活 YY 技能"。

**Q：如何更新已发布的技能？**
A：直接修改 SKILL.md 即可。系统会在下次激活时读取最新内容（可能有缓存延迟）。

**Q：技能可以包含代码吗？**
A：可以包含示例代码或脚本，但不能直接执行。如需执行，应通过 `shell_exec` 等工具调用外部脚本。

## 高级技巧

### 1. 条件分支

```markdown
## 根据场景选择流程

**场景 A：首次运行**
1. 步骤 A1
2. 步骤 A2

**场景 B：更新配置**
1. 步骤 B1
2. 步骤 B2
```

### 2. 参数化指令

```markdown
## 工作流参数

用户输入决定以下参数：
- `target_language`：目标语言（从用户消息提取）
- `output_format`：输出格式（markdown/json/plain）
- `verbosity`：详细程度（简洁/标准/详细）

根据参数调整输出...
```

### 3. 引用外部资源

```markdown
## API 参考

参见项目根目录 `API.md` 了解完整 API 规范。

关键端点：
- POST /api/v1/resource
- GET /api/v1/resource/:id
- ...
```

## 技能发布

### 本地使用

将技能放在以下位置之一：
- `<project>/skills/` - 项目级技能
- `<project>/data/skills/` - 用户自定义技能

### 共享技能

打包为目录并分享：
```bash
cd skills
tar -czf my-skill.tar.gz my-skill/
```

接收方解压到自己的 skills 目录即可。

## 资源

- Zhin.js 文档：https://zhin.js.org/docs/advanced/tools-skills
- 技能示例仓库：https://github.com/zhinjs/skills
- 社区技能市场：https://zhin.js.org/skills

---

**提示**：创建技能时，始终以"如果我是用户，会如何表达需求"的角度思考，确保 description 和 keywords 贴近实际场景。
