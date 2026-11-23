---
title: 升级：已并入或停更的包
description: 已并入其他包或已删除的 @zhin.js 包、各自的替代 import 与操作；zhin doctor 与 zhin migrate 如何提示它们
---

# 升级：已并入或停更的包

下面这些 `@zhin.js` 包已经并入其他包或被删除，不再发布新版本。它们在 registry 上的最后版本仍依赖旧的 Zhin 包（例如 `@zhin.js/config-yaml@1.1.0` 会拖进 `@zhin.js/runtime@1.1.0`、`@zhin.js/plugin-runtime@1.1.9`），项目只要还直接依赖其中一个，`node_modules` 里就会多出一份 Zhin 包，「Zhin 包单实例」检查随之报重复。用 `pnpm.overrides` 把版本压住只是掩盖：改写 import、删除这个依赖才是正解。

| 包 | 现状 | 替代 import | 操作 |
| --- | --- | --- | --- |
| `@zhin.js/ai-provider` | 并入 `@zhin.js/ai` | `@zhin.js/ai/provider` | 改写 import 后删除依赖 |
| `@zhin.js/config-file` | 并入 `@zhin.js/runtime` | `@zhin.js/runtime`（或 `@zhin.js/runtime/config-file`）：`YamlConfigDocument`、`JsonConfigDocument`、`createConfigDocument` | 改写 import 后删除依赖 |
| `@zhin.js/config-yaml` | 停更，并入 `@zhin.js/runtime` | `import { YamlConfigDocument } from '@zhin.js/runtime'` | 改写 import 后删除依赖 |
| `@zhin.js/host-api` | 已删除 | 无：`zhin start` 自动装配 Console 与 HTTP Host | 删除依赖及其插件配置 |
| `@zhin.js/host-router` | 已删除 | 无：HTTP 服务由 `zhin start` 装配的 `@zhin.js/host-http` 提供 | 删除依赖及其插件配置 |
| `@zhin.js/interaction` | 并入 `@zhin.js/im-contract` | `@zhin.js/im-contract/interaction` | 改写 import 后删除依赖 |
| `@zhin.js/isolate` | 并入 `@zhin.js/runtime` | `@zhin.js/runtime/isolate` | 改写 import 后删除依赖 |
| `@zhin.js/tools` | 已删除 | `@zhin.js/tool`（`defineAgentTool`，`tools/<name>/index.ts`） | 改写工具定义后删除依赖 |
| `@zhin.js/workroom` | 已删除 | 无：多 Bot 共享的群或频道改在 `ai.venues` 声明，协作范围写在 `agents/<name>/agent.json` 的 `collaboration` | 删除依赖 |

## 工具怎么提示

- `zhin doctor` 的「已停更的 Zhin 包」检查根目录和每个 pnpm 工作区成员的 `package.json`（`dependencies`、`devDependencies`、`optionalDependencies`、`peerDependencies`），每条写明在哪个文件、改用什么、删除哪个依赖，级别是警告。
- 「Zhin 包单实例」报重复时，先沿依赖链指出是哪个直接依赖拖进了旧版本；那个依赖在上表里时，直接给出上表的改法；`pnpm.overrides` 只作为最后一条建议。
- `zhin migrate` 不升级上表的包，并在「已停更的 Zhin 包」一步列出声明它们的 `package.json` 与项目源码里要改写的 import（文件与行号）。它不自动改写源码、也不删除依赖：停更包导出的内容不一定全部搬进了替代包，需要你确认后手动修改。

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
