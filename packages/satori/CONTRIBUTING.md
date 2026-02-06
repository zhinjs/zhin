# Satori 贡献指南

感谢您阅读本指南，我们欢迎任何形式的贡献。

## 提问

您可以使用仓库的 [讨论页面](https://github.com/vercel/satori/discussions) 来提问、发布反馈或分享您使用这个库的经验。

## 报告 Bug

当您发现任何问题时，请首先搜索仓库的 [Issues](https://github.com/vercel/satori/issues) 页面，确保该问题还没有被其他人报告过。

如果没有找到相关的问题，请随时创建一个新的 issue，详细描述问题和期望的行为。使用 [Satori 在线演示](https://og-playground.vercel.app) 重现 bug 会非常有帮助。

## 请求新功能

对于新功能，在开始工作之前与社区进行一些讨论会更好。您可以创建一个 issue（如果还没有的话）或在 [讨论页面](https://github.com/vercel/satori/discussions) 发帖来描述您想要的功能。

如果可能的话，您可以添加一些额外的上下文，比如这个功能如何从技术上实现，我们有哪些其他替代方案等。

## 本地开发

### 环境设置

这个项目使用 [pnpm](https://pnpm.io)。要安装依赖，请运行：

```bash
pnpm install
```

### 启动开发模式

要启动 Satori 的开发模式，请运行：

```bash
pnpm dev
```

这将启动开发服务器，监听文件变化并自动重新构建。

### 运行测试

Satori 使用 [Vitest](https://vitest.dev) 进行测试和生成快照。要启动测试并实时监听，请运行：

```bash
pnpm dev:test
```

这将更新快照图像。

您也可以使用 `pnpm test` 只运行测试。

### 类型检查

要运行 TypeScript 类型检查，请运行：

```bash
pnpm test-type
```

### 代码检查

要运行 ESLint 检查，请运行：

```bash
pnpm lint
```

要自动修复 ESLint 问题，请运行：

```bash
pnpm lint:fix
```

### 代码格式化

要检查代码格式，请运行：

```bash
pnpm prettier-check
```

要自动格式化代码，请运行：

```bash
pnpm prettier-fix
```

## 添加测试

### 测试结构

测试文件位于 `test/` 目录中：
- `html.test.ts` - HTML 功能测试
- `utils.ts` - 测试工具函数

### 编写测试

1. 创建测试文件（如果不存在）
2. 使用 Vitest 的 `describe` 和 `it` 函数
3. 使用 `expect().toMatchImageSnapshot()` 进行图像快照测试

示例：

```typescript
import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import satori from '../src/index.js'

describe('新功能', () => {
  it('应该正确渲染', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="color: red;">测试内容</div>
    </body></html>`)
    
    const svg = await satori(dom, {
      width: 100,
      height: 100,
      fonts: [...]
    })
    
    expect(svg).toMatchImageSnapshot()
  })
})
```

### 图像快照

Satori 使用图像快照来确保渲染结果的一致性。快照文件存储在 `test/__image_snapshots__/` 目录中。

当您修改渲染逻辑时，可能需要更新快照：

```bash
pnpm dev:test
```

## 代码规范

### TypeScript

- 使用 TypeScript 编写所有代码
- 为所有函数和变量提供类型注解
- 避免使用 `any` 类型

### 代码风格

- 使用 2 个空格缩进
- 使用单引号
- 不使用分号
- 遵循 ESLint 规则

### 提交信息

使用清晰的提交信息：

```
feat: 添加新的 CSS 属性支持
fix: 修复字体加载问题
docs: 更新 README
test: 添加新功能的测试
```

## 构建

要构建生产版本，请运行：

```bash
pnpm build
```

这将生成：
- `dist/index.js` - 主模块
- `dist/index.wasm.js` - WASM 版本
- 相应的类型定义文件

## 发布

发布过程是自动化的，当您创建 Pull Request 并合并到主分支时，会自动触发发布流程。

## 问题模板

### Bug 报告模板

```
## 描述
简要描述 bug

## 重现步骤
1. 创建 HTML 内容
2. 调用 satori
3. 观察结果

## 期望行为
描述期望的正确行为

## 实际行为
描述实际发生的行为

## 环境信息
- Node.js 版本
- 操作系统
- Satori 版本

## 额外信息
任何其他相关信息
```

### 功能请求模板

```
## 功能描述
详细描述您想要的功能

## 使用场景
描述这个功能的使用场景

## 实现建议
如果有的话，提供实现建议

## 替代方案
如果有的话，描述其他可能的解决方案
```

## 社区

- [GitHub Issues](https://github.com/vercel/satori/issues) - 报告问题和功能请求
- [GitHub Discussions](https://github.com/vercel/satori/discussions) - 讨论和问答
- [GitHub Pull Requests](https://github.com/vercel/satori/pulls) - 提交代码

感谢您的贡献！
