---
title: 升级：已并入或停更的包
description: 已并入其他包、改名或已删除的 @zhin.js 包与已删除的子路径、各自的替代 import 与操作；zhin doctor 与 zhin migrate 如何提示它们
---

# 升级：已并入或停更的包

下面这些 `@zhin.js` 包已经并入其他包、改名或被删除，不再发布新版本。它们在 registry 上的最后版本仍依赖旧的 Zhin 包（例如 `@zhin.js/config-yaml@1.1.0` 会拖进 `@zhin.js/runtime@1.1.0`、`@zhin.js/plugin-runtime@1.1.9`），项目只要还直接依赖其中一个，`node_modules` 里就会多出一份 Zhin 包，「Zhin 包单实例」检查随之报重复。用 `pnpm.overrides` 把版本压住只是掩盖：改写 import、删除这个依赖才是正解。

| 包 | 现状 | 替代 import 或替代包 | 操作 |
| --- | --- | --- | --- |
| `@zhin.js/adapter-process` | 改名为 `@zhin.js/adapter-sandbox` | `@zhin.js/adapter-sandbox` | 改依赖、按它的文档调整插件配置后删除旧依赖 |
| `@zhin.js/ai-provider` | 并入 `@zhin.js/ai` | `@zhin.js/ai/provider` | 改写 import 后删除依赖 |
| `@zhin.js/config-file` | 并入 `@zhin.js/runtime` | `@zhin.js/runtime`（或 `@zhin.js/runtime/config-file`）：`YamlConfigDocument`、`JsonConfigDocument`、`createConfigDocument` | 改写 import 后删除依赖 |
| `@zhin.js/config-yaml` | 停更，并入 `@zhin.js/runtime` | `import { YamlConfigDocument } from '@zhin.js/runtime'`；`YamlConfigDocumentError` 改名为 `ConfigFileDocumentError`，`ConfigDocumentParseError`、`ConfigDocumentConflictError` 改为继承 `ConfigFileDocumentError`（`ConfigDocumentParseError` 的构造参数多了 `format`） | 改写 import 与 `instanceof` 判断后删除依赖 |
| `@zhin.js/console` | 已删除（先改名为 `@zhin.js/host-api`，后者也已删除） | 无：`zhin start` 自动装配 Console 与 HTTP Host | 删除依赖及其插件配置 |
| `@zhin.js/console-app` | 已删除（Console 前端已移出本仓库） | 无：`zhin start` 自动装配 Console | 删除依赖 |
| `@zhin.js/console-core` | 改名为 `@zhin.js/pagemanager` | `@zhin.js/pagemanager`；浏览器端的 `loadConsoleEntries`、`apiFetch` 等在 `@zhin.js/client` | 改依赖后删除旧依赖 |
| `@zhin.js/console-types` | 并入 `@zhin.js/contract` | `@zhin.js/contract`（导出名以它的当前版本为准） | 改写 import 后删除依赖 |
| `@zhin.js/dependency` | 已停更 | 无直接替代 | 确认不再使用后删除依赖 |
| `@zhin.js/devteam` | 已停更 | 无直接替代 | 确认不再使用后删除依赖 |
| `@zhin.js/game-shared` | 改名为 `@zhin.js/game-kit` | `@zhin.js/game-kit`（按它的当前导出改写） | 改写 import 后删除依赖 |
| `@zhin.js/hmr` | 已停更 | 无直接替代 | 确认不再使用后删除依赖 |
| `@zhin.js/host-api` | 已删除 | 无：`zhin start` 自动装配 Console 与 HTTP Host | 删除依赖及其插件配置 |
| `@zhin.js/host-router` | 已删除 | 无：HTTP 服务由 `zhin start` 装配的 `@zhin.js/host-http` 提供 | 删除依赖及其插件配置 |
| `@zhin.js/http` | 已删除（先改名为 `@zhin.js/host-router`，后者也已删除） | 无：HTTP 服务由 `zhin start` 装配的 `@zhin.js/host-http` 提供 | 删除依赖及其插件配置 |
| `@zhin.js/http-host` | 已删除（拆进 `@zhin.js/host-router` 与 `@zhin.js/host-api`，两者也已删除） | 无：HTTP 服务由 `zhin start` 装配的 `@zhin.js/host-http` 提供 | 删除依赖 |
| `@zhin.js/interaction` | 并入 `@zhin.js/im-contract` | `@zhin.js/im-contract/interaction` | 改写 import 后删除依赖 |
| `@zhin.js/isolate` | 并入 `@zhin.js/runtime` | `@zhin.js/runtime/isolate` | 改写 import 后删除依赖 |
| `@zhin.js/plugin-github-notify` | 改为 GitHub 适配器 | `@zhin.js/adapter-github`（Webhook 通知是它的一部分） | 改依赖、按它的文档配置后删除旧依赖 |
| `@zhin.js/plugin-html-renderer` | 已删除 | `@zhin.js/html-renderer` | 改依赖后删除旧依赖及其插件配置 |
| `@zhin.js/plugin-test-kit` | 改名为 `@zhin.js/testing` | `@zhin.js/testing`（API 与 `PluginTestKit` 不变） | 改写 import 后删除依赖 |
| `@zhin.js/plugin-voice` | 已删除 | `@zhin.js/speech`，配置键 `voice:` 改为 `speech:` | 改依赖与配置后删除旧依赖 |
| `@zhin.js/queue-runtime` | 已停更 | 无直接替代 | 确认不再使用后删除依赖 |
| `@zhin.js/satori` | 已删除 | 栅格渲染统一由 `@zhin.js/html-renderer` 提供 | 改用替代包后删除依赖 |
| `@zhin.js/sensitive-filter` | 已删除 | `@zhin.js/plugin-content-moderation` | 改依赖并配置后删除旧依赖及其插件配置 |
| `@zhin.js/storage-port` | 已停更 | 无直接替代 | 确认不再使用后删除依赖 |
| `@zhin.js/types` | 已停更 | 无直接替代 | 确认不再使用后删除依赖 |
| `@zhin.js/workroom` | 已删除 | 无：多 Bot 共享的群或频道改在 `ai.venues` 声明，协作范围写在 `agents/<name>/agent.json` 的 `collaboration` | 删除依赖 |

「无直接替代」表示仓库历史里找不到接手它的包：这些条目只提示删除依赖，不推荐替代路径。

## 已删除的子路径

包本身仍在发布，但下面的子路径导出已经删除，import 它们会在安装或运行时失败：

| 子路径 | 改用 | 说明 |
| --- | --- | --- |
| `@zhin.js/agent/tools` | `@zhin.js/tool` | `defineAgentTool` 改从 `@zhin.js/tool` 导入，工具放在 `tools/<name>/index.ts`；`toolApprovalAlways` / `toolApprovalOnce` / `toolApprovalNever` 改成 `defineAgentTool` 的 `requiresApproval` 的 `'always'`、`'once'` 或 `'never'` |

## 工具怎么提示

- `zhin doctor` 的「已停更的 Zhin 包」检查根目录和每个 pnpm 工作区成员的 `package.json`（`dependencies`、`devDependencies`、`optionalDependencies`、`peerDependencies`），每条写明在哪个文件、改用什么、删除哪个依赖，级别是警告；项目源码 import 了上面已删除的子路径（或没有声明却 import 了停更包）时也给出警告，列出前 5 处的文件与行号。
- 「Zhin 包单实例」报重复时，先沿依赖链指出是哪个直接依赖拖进了旧版本（这份旧版本同时被某个工作区成员直接依赖时也照样指出）；那个依赖在上表里时，直接给出上表的改法，同一个停更包拖进多份旧版本时只给一条；`pnpm.overrides` 只作为最后一条建议。
- `zhin migrate` 不升级上表的包，并在「已停更的 Zhin 包」一步列出声明它们的 `package.json` 与项目源码里要改写的 import（文件与行号，含已删除的子路径；注释里和其他字符串里的写法不算）。停更包只导出包根时，带子路径的 import（如 `@zhin.js/isolate/x`）只给出操作，不给替代路径。它不自动改写源码、也不删除依赖：停更包导出的内容不一定全部搬进了替代包，需要你确认后手动修改。

## 改法示例

```ts
// 之前
import { YamlConfigDocument } from '@zhin.js/config-yaml';
// 之后
import { YamlConfigDocument } from '@zhin.js/runtime';
```

```bash
pnpm remove @zhin.js/config-yaml
# 删除为它加的 pnpm.overrides 后
pnpm install
zhin doctor   # 「Zhin 包单实例」应显示通过
```

另见 [CLI：doctor](../cli/index.md#doctor-环境诊断) 与 [CLI：migrate](../cli/index.md#migrate)。
