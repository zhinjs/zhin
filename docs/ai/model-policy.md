---
outline: deep
---

# 个人 Session 与模型策略

同一个人在具体私聊、群或频道中的 AI Session 独立保存聊天历史和模型选择。换模型保留历史；恢复继承会移除该 Session 的 chat 选择。当前运行回合固定其模型、连接版本和执行资源，选择变化用于后续回合。

模型配置按一条链解析：`连接 → 模型定义 → 调用预设 → 作用域策略 → 不可变回合快照`。Tool、MCP 和任务权限继续由 Agent 定义及执行策略管理，选个人模型不会获得额外权限。

## 部署配置

已有的 `ai.providers` 和 `ai.agents.<name>.provider/model` 仍可使用，Host 在入口将它们编译为同一目录与策略。没有显式绑定模型时，仅沿用该 Provider 配置的 `defaultModel` 或 `models[0]`；无法确定模型会报告迁移错误，不查询供应商或猜一个模型。

新的配置使用 `modelCatalog` 和 `modelPolicy`。下面的 `HOST_OWNER_ID` 需替换为当前项目的 Host 标识，`your-model-id` 替换为服务实际支持的模型。Host 标识由项目绝对路径计算，在项目目录执行以下命令即可查看；移动项目目录后需更新标识。

```sh
node --input-type=module -e 'import { createHash } from "node:crypto"; import { resolve } from "node:path"; console.log("host-owner:v1:" + createHash("sha256").update(resolve(".")).digest("hex"))'
```

```yaml
ai:
  modelCatalog:
    connections:
      main:
        id: main
        ownerId: HOST_OWNER_ID
        revision: 1
        sdk: openai-compatible
        baseUrl: https://your-provider.example/v1
        secretRef: env://AI_API_KEY
    models:
      main-chat:
        id: main-chat
        connectionId: main
        model: your-model-id
        capabilities:
          input: [text]
    presets:
      standard:
        id: standard
        modelId: main-chat
  modelPolicy:
    defaults:
      chat: standard
      summary: standard
  agents:
    zhin:
      nickname: Zhin
```

省略 `modelPolicy.defaults.summary` 时，配置编译阶段将部署的 `defaults.chat` 写入 summary。个人、Adapter、Endpoint 和 Scene 的 chat 覆盖不改变摘要模型。

分步迁移时，可同时保留完整的旧 `multimodal.perception` 配置及其 `providers` 别名。入口把其主模型与显式 `fallbacks` 编译后并入目录，ID 内容冲突会报错；未写 `defaults.perception` 时沿用已配置的旧感知链，写明时以该显式预设为准，不附带旧备用链。缺失的旧 Provider 别名仍是配置错误。

部署的 `modelCatalog` 只包含当前 Host owner 的连接；个人连接来自独立的个人目录，不写入部署目录。

主 Agent、普通 IM、系统任务和默认 standalone 调用统一选用 `modelPolicy.defaults.chat`。`agents.zhin` 可以只声明昵称、MCP 和权限，不必重复写模型预设。没有 policy 的旧表单仍从原 zhin 绑定生成默认值；所有显式写出的引用仍须有效。其他角色必须声明其预设。

每个字典键必须等于条目的 `id`。连接、模型及预设的引用必须存在。能力只按已声明的能力校验：未声明不会被当成支持；调用明确要求的能力不足会报错。`contextWindow` 和 `maxOutputTokens` 可作为模型定义的正整数元数据声明，不是低层作用域可覆盖的预算设置。

`secretRef` 是引用。Host 的 `env://NAME` 引用由执行层读取已配置环境变量；个人密钥由 Host 私有凭据库管理。新目录不接受 `apiKey`、认证 headers 或任意 SDK 参数。原有 Host Provider 的 headers、代理、重试、缓存和厂商参数保留在私有执行工厂中。修改连接地址、协议或凭据引用时递增 `revision`；同一版本内容冲突会拒绝使用。

`agents.<name>.preset` 与旧 `provider/model` 不能同时设置。昵称、MCP 和 `permission` 属于该 Agent 的独立配置，不会写入预设或从个人模型继承。显式角色预设也不会套用个人 chat 选择。

## 覆盖范围

| 层级 | 可以选择的用途 |
| --- | --- |
| 默认 | chat、perception、summary |
| Adapter | chat、perception |
| Endpoint | chat、perception |
| Scene | chat |
| 个人 Session | chat 预设，或恢复继承 |

各值只引用完整预设，不做任意对象合并。Adapter 按平台名配置；Endpoint 和 Scene 使用完整地址，避免多个账号、群或线程共用设置。比如只修改 Sandbox 的聊天模型：

```yaml
ai:
  modelPolicy:
    defaults:
      chat: standard
      summary: standard
    adapters:
      sandbox:
        chat: sandbox-chat
```

`standard` 与 `sandbox-chat` 都必须存在于同一目录。Endpoint 地址包含 `rootId/platform/endpoint/adapterId`；Scene 地址包含 `rootId/platform/endpoint/conversation`，其中 conversation 保留 Adapter entry、会话类型、父会话及 thread 标识。完整字段见[配置参考](../configuration/generated.md)。

显式选择不存在、无权使用或能力不足的预设会报错，不退回上一层。定时、HTTP 和内部系统任务没有 IM 地址时只使用默认策略，不借用最近发言者的个人模型。原有感知 `fallbacks` 按配置顺序迁移为独立、固定的感知执行链；没有配置就不添加。所有聊天回合（包括旧配置与个人选择）都固定选定模型：保留同模型重试，失败后报告原因，不再自动切换其他模型或 Provider。原生结构化决策服务仍由 `ai.decisions` 选择。

## 个人模型与 Console 身份

管理员通过 `ai.personalPrincipals` 将已认证的 Console principal 绑定到完整 IM owner。owner 必须包含 `rootId/platform/endpoint/adapterId/subjectId`；客户端不能自行声称另一个 owner。公开场景事件、个人历史、Session 选择和场景管理各有独立状态边界。

个人模型连接只允许 HTTPS 公网服务，执行传输逐跳检查 DNS；只允许同源 HTTPS 重定向，跨域报错。地址中的认证参数（如 `api_key`、`access_token`）必须改填独立 API Key 字段，普通 `region` 等参数保留；Host 自己配置的本地服务保持原访问方式。创建连接和选择模型不会隐式发起模型请求。个人 API key 不进入配置目录、Session、提示词、Journal 或导出。

管理员在 `http.tokens` 中给个人 token 指定 `scope: user` 和稳定的 `principalId`，再用同名 `ai.personalPrincipals` 条目绑定 IM owner。主 token 或未绑定 principal 的 full token 不代表某个个人身份。`rootId` 使用 Host 的真实项目路径，`endpoint` 是账号实例，`adapterId` 是 canonical Adapter entry id，不能用展示名代替。Console 的“个人模型”页只呈现服务器认可的身份，并提供当前个人会话的模型选择。

密钥保存在 `.zhin/personal-model-credentials` 的加密文件中；主密钥 `root-key.json` 和密文一起由 Host 私有权限保护。备份和恢复须同时保留这两类文件与数据库中的引用；不要单独删除主密钥。元数据提交结果未知时保留新密文，不自动重试或清理。读取失败、损坏与不存在会分别处理。

## 迁移检查

1. 保留原配置和历史。先运行 `zhin config check`，确认 Provider SDK、模型和 MCP 引用有效。
2. 可继续使用原配置；若改用新表单，把连接、模型、预设和作用域引用一起写清。`--fix` 不会自动重分配旧共享会话历史或创建个人模型。
3. 为实际需要的用途明确选择预设；不要把权限、密钥或 SDK 参数复制进作用域覆盖。
4. 用隔离测试连接确认实际模型、地址及取消行为后再自行安排真实供应商验收。配置检查和本地测试不代表已部署或已完成真实供应商验证。

数据库变更仅添加可空的个人来源维度及索引，不改写或删除旧共享历史。代码回滚时保留这些列、个人会话记录及凭据库；旧运行时不会自动把个人历史重新分配为共享历史。移动项目目录会改变 Host 身份，不能直接把旧个人绑定当作新 Host 的授权。

契约与所有权决策见 [ADR 0045](../adr/0045-personal-session-model-policy.md)。
