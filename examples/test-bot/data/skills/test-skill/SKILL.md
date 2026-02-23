---
name: test-skill
description: 文件操作测试技能。当用户要求读取、写入或搜索文件相关内容时使用。可演示工具关联和技能工作流。
keywords:
  - test-skill
  - test
  - skill
  - 技能
  - 文件
  - 读取
  - 写入
  - 搜索
  - 查询
  - 查找
  - 研究
  - 研究
  - 最佳实践
  - node
  - nodejs
  - file
  - read
  - write
  - search
  - query
  - find
tags:
  - testing
  - development
  - file-operations
  - search
  - node.js
tools:
  - read_file
  - write_file
  - web_search
---

# Test Skill - 文件操作和技能工作流测试

此技能演示如何使用关联的工具完成实际任务。当用户请求与此技能相关的操作时，**立即执行相应的工具调用**。

## 关联的工具

该技能包含以下工具：
- **read_file** - 读取文件内容（参数: file_path）
- **write_file** - 写入或修改文件（参数: file_path, content）
- **web_search** - 网络搜索相关信息（参数: query）

## 执行规则

**此技能被激活后，你必须立即执行用户请求对应的工具调用，而不仅仅是描述如何做。**

### 规则 1：立即执行文件读取

当用户要求"读取"、"查看"、"打开"任何文件时：
1. **立即调用** `read_file` 工具，参数 file_path 是用户指定的文件路径
2. 成功后，分析文件内容
3. 返回有逻辑的总结或完整内容

❌ 错误做法：只说"我会用 read_file 读取文件"
✅ 正确做法：直接调用 `read_file(file_path: "...")`

### 规则 2：立即执行文件写入

当用户要求"写入"、"修改"、"更新"任何文件时：
1. **先调用** `read_file` 获取现有内容
2. **立即调用** `write_file` 应用更改
3. 确认修改成功

### 规则 3：立即执行搜索

当用户要求"搜索"、"查询"、"查找"信息时：
1. **立即调用** `web_search` 工具
2. 整理搜索结果
3. 返回格式化的答案

## 工作流程示例

### 场景 1：读取 package.json

**用户说**：
> "使用 test-skill 读取 package.json 文件"

**你应该立即做**：
1. 调用工具：`read_file(file_path: "package.json")`
2. 等待工具返回文件内容
3. 解析 JSON 并返回：
   ```
   📋 package.json 内容：
   
   名称: test-bot
   版本: 0.1.0
   主要依赖: zhin.js, typescript, ...
   可用命令: dev, build, start, test
   ```

### 场景 2：读取并修改配置

**用户说**：
> "修改 zhin.config.yml 中的 log_level 为 DEBUG"

**你应该立即做**：
1. 先读：`read_file(file_path: "zhin.config.yml")`
2. 再改：`write_file(file_path: "zhin.config.yml", content: "...")`
3. 确认：✅ 已修改 log_level 为 DEBUG

### 场景 3：搜索信息

**用户说**：
> "搜索 TypeScript 中的类型守卫用法"

**你应该立即做**：
1. 搜索：`web_search(query: "TypeScript 类型守卫")`
2. 整理结果
3. 返回相关信息

## 关键指导：不要只描述，要执行！

**激活此技能后，用户期望的是你直接调用工具，而不是：**
- ❌ 解释如何调用工具
- ❌ 列出工具的参数说明
- ❌ 描述你会做什么
- ✅ 直接调用工具
- ✅ 显示工具执行结果
- ✅ 解释和分析结果

## 常见用例与直接执行

| 用户请求 | 应该立即调用 | 返回内容 |
|---------|----------|--------|
| 读取 package.json | read_file(file_path: "package.json") | 文件内容总结 |
| 查看 src/main.ts | read_file(file_path: "src/main.ts") | 代码内容或摘要 |
| 修改配置 | read_file + write_file | 确认修改成功 |
| 搜索 Node.js 用法 | web_search("Node.js ...") | 搜索结果总结 |

## 计时要求

- **立即执行**：用户请求后，无延迟地调用工具
- **不要等待**：不要问"你确定要读取这个文件吗？"
- **快速反馈**：执行后立即返回结果

## 测试场景

### 测试 1：基础读取
```
用户：使用 test-skill 读取 package.json 文件
预期：AI 立即调用 read_file → 显示内容
```

### 测试 2：多步骤操作
```
用户：使用 test-skill 读取 README.md 然后告诉我概要
预期：AI 立即调用 read_file → 分析 → 返回概要
```

### 测试 3：搜索操作
```
用户：使用 test-skill 搜索最新的 Node.js 最佳实践
预期：AI 立即调用 web_search → 整理结果 → 返回
```

## 工具响应处理

收到工具响应后：
1. **成功**：分析结果并返回对用户有价值的信息
2. **失败**：告诉用户失败原因并提出解决方案
3. **超时**：通知用户并询问是否重试

## 不要做的事

❌ 激活技能后只输出技能内容本身
❌ 解释如何使用工具而不实际使用
❌ 等待进一步指令再执行
❌ 提供工具参数示例而不实际调用
✅ 根据用户请求，直接调用相应工具
✅ 立即返回工具执行结果
✅ 分析和解释结果
✅ 成功完成用户任务
