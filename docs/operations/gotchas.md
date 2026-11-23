---
title: "常见问题与反直觉行为"
description: "部署 Zhin 时容易踩到的规律：配置种子、热重载与重新登录、MCP 绑定、备用模型、Sandbox 发图、内存与依赖"
---

# 常见问题与反直觉行为

这里收集部署者反复踩到、但不算故障的规律。每条都按当前版本核对过；已经修掉的问题不在这里。部署步骤见[生产部署与运维](./production.md)，排查具体故障见[故障排查中心](../troubleshooting/index.md)。

## 改了 yml 里的 `endpoints`，账号没变 {#endpoints-seed}

**现象**：在 `zhin.config.yml` 的适配器块里增删或修改 `endpoints`，重启后新账号没有运行，删掉的账号照样登录。

**原因**：`endpoints` 只是**首次种子**。项目数据库里还没有这个适配器的账号记录时，启动按 yml 创建账号；之后以数据库里保存的账号为准，Console 的新增、修改、启停改的都是数据库。yml 再改不会自动生效。

**怎么做**：日常增删账号用 Console「连接管理」。两边不一致时，启动日志有 `endpoint_config_drift` 警告，Console「需要你处理」会列出差异，可以在账号页逐个「从配置导入」或「写回配置文件」。详见[配置文件账号与已保存账号](../configuration/index.md#endpoints-drift)。

## 生产环境开了 `--watch`，升级后账号还是要重新登录 {#watch-relogin}

**现象**：为了少重登，生产实例加了 `--watch`，可升级插件或改代码后，账号照样掉线重登（ICQQ 这类账号可能还要重新过验证）。

**原因**：热重载只在很窄的范围内原地换代：

- 只有本地挂载插件（主配置里 `./` 开头的引用）约定目录里的单个能力文件（`commands/`、`tools/` 等）能按能力重载，不动适配器；
- 改插件入口或被多个模块共享的 `src/` 模块，会重建整个插件甚至整个实例；重建的是适配器插件时，它的账号跟着重新登录；
- `package.json`、锁文件（`pnpm-lock.yaml` 等）或 `.env` 变化会重启实例，所有账号重新登录；
- 从 `node_modules` 解析的包（`pnpm add` / `pnpm update` 装的插件）根本不被监听。

所以生产上最常见的「升级包」一定会重启实例，`--watch` 省不掉这次重登，反而让任何误改都触发重载。

**怎么做**：生产继续用 `--no-watch`（脚手架的 `pnpm start`），把升级安排在低峰时段并在升级后检查账号状态。启停插件不需要重启：经网关的启停在运行中的实例里换代，适配器不重新登录。热重载的范围见[本地联调指南](../authoring/local-dev.md)，启停插件见 [CLI：启用与停用插件](../cli/index.md)。

## `/pub/ready` 返回 200，账号却还没在线 {#ready-not-online}

**现象**：实例显示就绪、健康检查通过，可某个账号还在登录、等扫码或滑块。

**原因**：账号登录不阻塞实例就绪。每个账号最多等约 3 秒，没登录完的账号转到后台继续；`gateway.readyTimeout` 也只约束实例就绪，不再覆盖账号登录耗时，所以要过滑块的账号不会把整个实例卡在就绪前。

**怎么做**：需要某个账号在线才算就绪时，把它写进 `http.readiness.endpoints`；在 Console 的登录待办里完成验证。详见[网络与鉴权](./production.md#_2-网络与鉴权)。

## MCP 服务器显示「已连接」，Agent 却用不了它的工具 {#mcp-unbound}

**现象**：`ai.mcpServers` 里的服务器连接成功，聊天里 Agent 说没有这个工具。

**原因**：`ai.mcpServers` 只负责连接；Agent 要在 `ai.agents.<name>.mcpServers` 里写上服务器名才拿得到它的工具。IM 消息一律按 `ai.agents.zhin.mcpServers` 取，只绑在别的 Agent 上的服务器，聊天里用不了。

**怎么做**：在 `ai.agents.zhin.mcpServers` 里列出服务器。`zhin status` 会在该行注明「已连接但没有 Agent 能用」，`zhin doctor` 与 Console「需要你处理」也会列出它（`mcp.unbound`）。详见 [ai.mcpServers](../ai/index.md#ai-mcpservers)。

## 配了备用模型，主模型出错却没有切换 {#fallback-not-switching}

**现象**：用途上配了 `fallbacks`，主模型报错时这一轮直接失败，没有换到备用模型。

**原因**：只有另一个账号能解决的错误才切换：

| 切换 | 不切换 |
| --- | --- |
| 额度用完、余额不足 | 限流（429） |
| 密钥被拒（401、`UNAUTHENTICATED`、`API_KEY_INVALID` 一类） | 单纯的 403（网关按内容或地区拒绝） |
| 同一次请求里同一模型连续 2 次超时 | 偶发的一次超时（按原来的同模型重试） |
| 网络错误、服务端 5xx，且同模型重试（`providerResilience`）用完 | 请求被拒（400 一类）、内容拦截、上下文超长 |

另外，已经向用户输出了文字的请求不再切换；备用模型接不住这次请求（不支持对话里的图片、上下文放不下、接不上进行中的工具调用）时会被跳过。

**怎么做**：用 `zhin trace` 看这一轮：切换过的记为 `model_fallbacks`，没切换的记为 `model_fallback_skips` 并写明原因（`no_fallbacks`、`not_switching`、`exhausted`、`streamed`、`retry_forbidden`）。在 Console 保存用途或重新导入 `ai.plan.yml` 会替换整条备用链，写入时把 `fallbacks` 一并写上。详见[备用模型](../ai/model-policy.md#备用模型fallbacks)。

## 在 Sandbox 里上传的图片，Agent 看不到 {#sandbox-image}

**现象**：在 Console Sandbox 拖放或粘贴一张图片发给 Bot，Agent 回答说没有看到图片。

**原因**：上传的文件以签名地址插入消息，但插件和 Agent 在进程内读取上传文件还没有实现；Agent 的入站媒体按网络策略只取 HTTPS、拒绝私有地址，所以读不到 Sandbox 自己托管的文件。

**怎么做**：测试识图时用公网可访问的 HTTPS 图片地址：在 Sandbox 里插入图片 URL，或在文本里写 `[image:https://…]`。详见 [Sandbox 适配器](../adapters/sandbox.md)。

## 旧项目的 `BOT.md` 让 Agent 调用不存在的 `cron_add` {#bot-md-cron-add}

**现象**：让 Bot 设提醒，它说要用 `cron_add`，或者只把提醒写进记忆文件，到点什么也没发生。

**原因**：旧版脚手架和 `zhin migrate` 生成的 `BOT.md` / `AGENTS.md` 里写着「Use `cron_add` for scheduled reminders」，这个工具从来不存在。新生成的文件已改正，已有项目里的文件不会被自动改写。

**怎么做**：打开项目的 `BOT.md`（或 `AGENTS.md`），把「Reminders」一节改成：固定文案的提醒（一次性或固定间隔）用 `reminder_create`（需要安装提醒插件）；到点由 AI 生成内容、调用工具，或按工作日 / 农历等日历规则运行的任务用 `schedule_add`，改已有任务用 `schedule_update`，不要删除后重建；提醒不要只写进记忆。内置的 `schedule_add` 工具说明里也写了这些规则。

## 项目里只有一个 `.tsx` 文件，内存也多了一截 {#tsx-memory}

**现象**：项目里只有一个 `.tsx` 命令或组件，实例常驻内存却明显比全是 `.ts` 时高。

**原因**：Node 能直接加载 `.ts`，但不认识 `.tsx`。第一次遇到 `.tsx` 入口时，实例为它启用隔离的 TSX 加载器，这个加载器连同它启动的 esbuild 子进程会一直驻留到实例退出。只要有一个 `.tsx` 文件就会启用，和文件数量无关。

**怎么做**：内存紧张的部署，可以把这些入口改写成不含 JSX 语法的 `.ts` 文件，就不会启用这个加载器；需要 JSX 时接受这部分常驻开销。加载方式见 [zhin runtime start：`.tsx` 入口](../cli/runtime.md)。

## `zhin doctor` 报 Zhin 包重复，升级依赖也消不掉 {#retired-package}

**现象**：「Zhin 包单实例」检查报某个 `@zhin.js/*` 包有两份，按提示升级或 `pnpm dedupe` 后仍然重复。

**原因**：重复副本常常是项目还直接依赖着已经停止发布、功能并入其他包的旧包拖进来的，例如 `@zhin.js/config-yaml`（`YamlConfigDocument` 已并入 `@zhin.js/runtime`）。旧包不会再有新版本，它依赖的旧版 `@zhin.js/runtime` 等也就一直留着；`doctor` 目前不识别这类旧包。

**怎么做**：看 `doctor` 输出里每个副本后面「由谁依赖」的那一段；指向这类旧包时，把代码改为从替代包导入（例如 `import { YamlConfigDocument } from '@zhin.js/runtime'`），从 `package.json` 删除旧包，重新安装后再运行 `zhin doctor`。不需要为此加 `pnpm.overrides`。见 [CLI：doctor](../cli/index.md)。
