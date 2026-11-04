---
title: AI Provider 目标接口升级
description: 新旧插件版本边界、显式模型迁移与恢复流程。
---

# AI Provider 目标接口升级

这是一次完整接口替换，按项目确认仍使用 patch 发布。新旧配置不会在同一进程中并行执行；升级前保留数据库、启动配置和 Host 本地加密主密钥的备份。本文的下一 patch 号是发布计划，尚未发布，不能据此声称已可安装。

## 插件版本边界

| 包 | 旧接口支持上限 | 目标接口计划最低版本（待发布） |
| --- | --- | --- |
| `@zhin.js/ai` | `1.1.50` | `1.1.51` |
| `@zhin.js/ai-provider` | 无此目标接口包 | `1.0.1` |
| `@zhin.js/agent` | `1.1.46` | `1.1.47` |
| `@zhin.js/cli` | `1.1.27` | `1.1.28` |
| `@zhin.js/runtime` | `1.1.17` | `1.1.18` |
| `@zhin.js/core` | `1.1.55` | `1.1.56` |
| `@zhin.js/feature-kit` | `1.1.11` | `1.1.12` |
| `@zhin.js/command` | `1.1.13` | `1.1.14` |
| `@zhin.js/tool` | `1.1.14` | `1.1.15` |
| `@zhin.js/component` | `1.1.12` | `1.1.13` |
| `@zhin.js/handler` | `1.1.11` | `1.1.12` |
| `@zhin.js/middleware` | `1.1.12` | `1.1.13` |
| `@zhin.js/schedule-feature` | `1.1.11` | `1.1.12` |
| `@zhin.js/service-typesafe` | `1.0.15` | `1.0.16` |
| `@zhin.js/scaffold-wizard` | `1.1.14` | `1.1.15` |
| `create-zhin-app` | `1.1.15` | `1.1.16` |
| `@zhin.js/client` | `1.1.23` | `1.1.24` |
| `@zhin.js/database` | `1.1.5` | `1.1.6` |
| `@zhin.js/host-http` | `1.1.13` | `1.1.14` |
| `@zhin.js/a2a` | `1.1.22` | `1.1.23` |
| `@zhin.js/workroom` | `0.0.15` | `0.0.16` |

新插件声明所用配套版本的最低依赖，不混用旧 FeatureKit／Command／Tool 的执行上下文。使用旧 Provider、Catalog、运行时 override 或位置参数接口的插件，应把依赖上限锁在表中旧版本，完成迁移后再提升。实际发布以最终 changeset 和发布说明为准；本次修改不执行 bump、发布或部署。

## 配置迁移

旧 `ai.providers`、`modelCatalog`、`modelPolicy`、`defaultProvider`、`agents.<name>.provider/model/preset`、`multimodal.perception.provider/model/fallbacks`、`trigger.ambient.judge`、全局 `imageGeneration` 不能继续作为启动选型权威。识别到这些旧字段时，CLI 启动受认证的迁移管理模式；旧模型执行入口停用，原文件和数据保留。无需先手删旧配置才能打开 Console。其他配置错误仍明确报错，不作为迁移成功处理。

迁移预览只读取选中源的元数据，输出 `migration.json`：其中 `units` 含各 owner 的 `plan`、明确映射与待补项，密封 proof 绑定原始源。它不是普通 `ai.plan.yml`，不能把单独 plan 文件传给 `--apply`。它不登录、不请求模型、不加载 `.env`、不解密旧 vault、不改数据库。读取旧启动原文时可能遇到旧内联字段，公开预览只保留 locator，不输出明文；私有源证明由 Host 密封。SDK 命名空间参数、不明确的模型能力、父频道／话题身份或多候选旁听模型不能猜测；补齐明确映射后再次预览。


在项目目录内执行（文件名仅为示例，不含密钥）：

```bash
zhin migrate inference --mapping inference-mapping.json --output migration.json
# 审查 blocked 项；补齐映射后输出到新文件，原预览不会被覆盖。
# 停止 Bot，备份启动文件、数据库与 Host 本地主密钥后：
zhin migrate inference --apply migration.json --maintenance --backup-confirmed
# 只有预览明确列出旧加密凭据且同意重封装时，才在 apply 增加 --with-credentials。
zhin migrate inference --finalize migration.json --maintenance --backup-confirmed
```

预览可省略 `--mapping` 先查看待补项；非 SQLite 的旧元数据通过 `--state-snapshot` 显式提供，需要独立数据库连接文件时使用 `--database-config`，这些只用于生成预览。Apply／finalize 使用同一已审查文件，不接受另换源或映射。私有备份和 `migration.json` 应由本机管理员保管，不公开提交。数据库提交与启动文件切换分步记录 journal；只有 finalize 完成后才恢复正常启动。详见[离线迁移入口](../plans/inference-migration-cli-contract.md)。

原有权限、MCP、昵称等角色设置仍属于 Agent 启动配置，不混入 Profile。生成参数属于 Profile；摘要、审批、旁听不再添加各自隐式温度／输出上限。通用 SDK 未显式设上限时仍沿用模型目录声明值／既有 8192 有效默认，Codex 协议无该字段；本次没有全局取消默认预算。兼容协议和 Google 缓存设置属于 Service。旧 API Key／Vault 记录由 Host 在单独授权的私有迁移边界内解密并重新封装，公开预览只含来源定位。源版本、选中范围、完整预览指纹及 receipt 都须在提交时核对。

个人 Session 的旧 preset 选择必须由管理员映射到真实目标 Profile 身份，不按同名别名自动继承；继承默认值的 Session 保留 `inherit`。删除重建账号或改变真实身份后，旧选择不能自动绑定新 incarnation。

Workroom 的旧 `disclosure.modelProviders` 需要明确映射到 `modelServices` 的真实 Service ID。处理合同与实际所选 Service 不匹配时停止披露，不以模型名称或旧 Provider 别名推断合同。


### 官方 TypeSafe 的手工迁移

TypeSafe 不属于 headless 内置目录，离线 compiler 会把旧 `ai.decisions` 标为待显式处理，不会为预览执行插件 JS。先进入维护期并备份原配置、数据库和主密钥；保留 TypeSafe 插件声明，按[TypeSafe 升级步骤](https://github.com/zhinjs/zhin/blob/main/plugins/services/typesafe/README.md)移除其已退役的 secret/model/enabled 插件配置以及旧 `ai.decisions` 路由，再启动新 Host 管理界面。使用插件实际注册的 exact `typesafe` Driver，建立 API Key Account、`typesafe-system-one`／`decision` 模型与 Profile，然后逐项重建六个决策用途。native ID 沿用旧配置的实际值；每项原 mode、阈值与超时必须明确保留，不因升级自动启用。

尚未完成新用途配置前不要恢复自动业务；Session 旧选择需要单独显式绑定。恢复时先按下方恢复段核对 journal 与共享数据库的后续写入，再使用对应原包版本、配置、选中数据与主密钥；不能覆盖其他 Root 新写，也不能让旧程序读取新图猜兼容。新图与旧原文在确认前都保留，不自动删除。


### 只恢复旧 Session 到已存在的 Profile

先通过正常 Console 为原 owner 建好 Profile；第三方 Driver 也由正常插件注册，迁移工具不会执行它。用 `zhin migrate inference --output legacy-sources.json` 查看原 Session 的 `identity.key` 与物理 `sourceRevision`（不是 Session state 内的数字 revision），再填写明确映射：

```json
{
  "version": 1,
  "sessions": {
    "personal-session:v1:<原完整key>": {
      "sourceRevision": "<预览中的源版本>",
      "selection": {
        "kind": "profile",
        "profile": {
          "id": "<现有Profile ID>",
          "rootId": "/absolute/project/root",
          "accountId": "<现有Account ID>",
          "accountIncarnation": "<当前账号incarnation>",
          "kind": "language"
        }
      }
    }
  }
}
```

要恢复默认选择，显式使用 `"selection": { "kind": "inherit" }`，不能靠缺字段或同名旧 preset 猜测。

```bash
zhin migrate inference --sessions-only --mapping session-bindings.json --output session-preview.json
zhin migrate inference --apply session-preview.json --maintenance --backup-confirmed
```

SQLite 预览只读数据库并提前验证目标；非 SQLite 使用已有 `--state-snapshot` 显式源快照，标明 `targetValidation: deferred-until-apply`，不连远端。所有数据库在 apply 第一笔 Session CAS 前都会重新核对全部目标、静态 owner、完整 Account 身份和原源版本；任一项失败不写其他选中 Session。此模式不切换启动文件、不读取模型凭据、不加载 Driver、不删旧 catalog。它只保存 Profile 身份，参数与 native model 仍在下一回合跟随该 Profile。

## 作者接口

- 底层 `ContextManager` 通过 `setSummaryCompletion({ system, prompt, signal } => Promise<string>)` 注入调用者拥有的摘要操作，不再安装 Provider 或隐藏采样参数。
- 删除 `SdkProviderAdapter`、`createSdkProviderAdapter`、`sdkEntryFromProvider` 和 `@zhin.js/ai/model-catalog`。Driver 是声明／协议实现；Host 统一拥有配置、凭据和调用生命周期。
- 普通命令／工具经正式 `context.use(aiInferenceClientToken)` 调用；不保存进程级 client，不自行填 principal／owner。
- `createCapabilityContext` 使用具名 options 对象。`ToolIndex.execute` 使用 `{ requester, name, input, invocation, snapshot?, operation? }`；operation 必须来自 Host 的真实入口，不能放在用户 JSON metadata 里。
- Agent 构造不再要求一个 Provider。独立调用显式借用 `ModelExecutionScope`，由取得作用域的一方负责释放。真实 generation lease 从正式任务入口传入，不能通过最新全局对象补齐。
- `ProfileSelection` 保存不可复用身份；每回合解析该身份的当前参数。短期 `ProfileRef` 固定本次 revision，不能当长期 Session 选择保存。同 Profile 可以原位更换 native model；已有 Session 下回合跟随，在途调用不变。换 Account 后，旧 Session 的 accountId/incarnation pin 失效，不自动跨账号继承。

数据库类型入口已隔离：`@zhin.js/database` 默认入口保留中性数据库／模型／事务 API 与 Memory／SQLite；Core、Agent、Zhin 的默认声明不再牵引未选外部方言。SQLite 用户无需安装 MySQL、PostgreSQL、MongoDB、Redis 驱动或声明。使用外部方言的 TypeScript 作者从 `@zhin.js/database/dialects/mysql`、`@zhin.js/database/dialects/pg`、`@zhin.js/database/dialects/mongodb` 或 `@zhin.js/database/dialects/redis` 引入对应类与完整原厂配置类型。

PostgreSQL 的 TypeScript 消费者还需显式安装与 `pg` 匹配的 `@types/pg`；JavaScript-only 用户只需 `pg`。默认入口仍自动注册六个 factory，`Registry.create()` 保持同步，所选客户端只在连接时加载。导入示例见 [Database TypeScript 入口](https://github.com/zhinjs/zhin/blob/main/basic/database/README.md#typescript-entry-points)，隔离合同与真实归档验证见[数据库可选方言类型隔离](../plans/database-optional-dialect-types.md)。

## 恢复

提交结果未知时先用原 mutationId 查询 receipt，不能新建 ID 重试。失败／冲突不报告已保存。恢复旧版本代码前，先按迁移 journal 核对选中记录。只有在同一维护窗口且共享数据库的其他 Root 没有后续写入时，才恢复整库与对应主密钥备份；否则按选中 unit／Session 的 before/after 记录人工核对恢复，不能覆盖其他 Root 新写；不要让旧版本读取新目标图并猜测兼容关系。外部 token 轮换不能通过本地备份撤销。原始迁移源保留到管理员确认恢复完成，不自动删除。

本地 mock／SQLite／HTTP 与构建验证只证明代码合同。订阅真实账号、供应商行为、费用和部署效果须在单独授权后验收。
