# 插件生命周期

从一个命令开始，到测试、构建、发布，Zhin 推荐按下面路径推进。

## 1. 从单文件插件开始

适合项目内私有能力：

```ts
// src/plugins/hello.ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(new MessageCommand('hello').action(() => '你好！'))
```

在 `zhin.config.yml` 中启用：

```yaml
plugins:
  - hello
```

保存后 `pnpm dev` 会热重载。

## 2. 创建可发布插件包

适合多人复用、发布到 npm、带测试或 Console 页面：

```bash
npx zhin new my-plugin
```

生成内容包括：

- `src/`：插件入口与业务代码
- `tests/`：Vitest 测试
- `skills/`：可选 AI Skill
- `client/`：可选 Console 页面
- `package.json`：发布元数据与构建脚本

## 3. 开发规则

两条规则最重要：

| 规则 | 正确姿势 |
|------|----------|
| `usePlugin()` 在顶层调用 | 在模块加载时注册命令、工具、中间件 |
| 运行时不要 `getPlugin()` | 在注册时捕获 `logger`、`root`、服务闭包 |

本地文件导入通常要带 `.js`：

```ts
import { helper } from './helper.js'
```

## 4. 测试和构建

```bash
pnpm test
pnpm build
```

只测当前插件时，进入插件包目录或使用 pnpm filter。

## 5. 安装验证

在示例项目中验证安装与启用：

```bash
npx zhin install ./plugins/my-plugin --dry-run
npx zhin install ./plugins/my-plugin
npx zhin doctor
pnpm dev
```

## 6. 发布

发布前确认：

- `package.json` 的 `name` 是 `zhin.js-*` 或 `@zhin.js/*`。
- `keywords` 包含 `zhin.js`。
- `files` 包含运行所需的 `lib` / `dist` / `skills`。
- README 写明安装命令和 `plugins` 配置。

更多 API 示例见 [插件开发指南](/guide/plugin-development)。
