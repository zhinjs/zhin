# 配置即数据

Zhin.js 的配置不是代码，是一份**被 schema 严格约束的数据文档**（`zhin.config.yml`）。每个包用 `schema.json` 声明自己的配置契约，运行时把整份文档对着由插件树组合出的有效 schema 做 Ajv strict 校验，然后按 owner 把配置投影给每个插件。配置变更走事务：要么整个生效，要么完全回滚。

## 文档结构

```yaml
# Root Plugin 的配置（对应 Root 包 schema.json）
plugin:
  terminal:
    interactive: true

# 子插件配置，按 instanceKey 命名空间隔离
plugins:
  sandbox:
    endpoints:
      - name: full-bot-sandbox
        context: sandbox
        owner: local-user
  napcat:
    connection: ws
    endpoints:
      - name: full-bot-napcat
        url: ${ONEBOT11_WS_URL}          # 环境变量插值
        access_token: ${ONEBOT11_ACCESS_TOKEN}
```

有效 schema 由 `ConfigComposer`（`packages/im/runtime/src/config-composer.ts`）按插件树组合：

- `plugin` — Root Plugin 自己的 schema；
- `plugins.<instanceKey>` — 每个子插件的 schema，嵌套子插件递归挂在父 schema 的 properties 里；
- Host 级键 `http` / `database` / `ai` / `mcp` / `a2a` / `speech` / `htmlRenderer` / `assistant` / `collaboration` / `log_level` — 由 CLI 的 Root 安装器消费，**不会**进入任何插件的配置视图；
- 顶层结构 `additionalProperties: false`：写错键名（比如 `plugin` 打成 `plugn`）会直接报错，而不是被静默忽略。

## schema.json：声明式契约

每个包根目录的 `schema.json` 就是它的配置契约。`examples/minimal-bot/schema.json`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "commandPrefix": { "type": "string", "default": "/" },
    "terminal": {
      "type": "object",
      "additionalProperties": false,
      "default": {},
      "properties": {
        "interactive": { "type": "boolean", "default": true },
        "prompt": { "type": "string", "default": "zhin> " }
      }
    }
  }
}
```

约束与行为：

- 根必须是 object schema；没有 schema.json 时按空 object 处理。
- 根上不允许纯组合式 schema（`anyOf`/`oneOf`/`allOf`/`$ref` 而无 `properties`）——它能通过校验但会让配置投影静默变空，因此被显式拒绝。
- 校验用 Ajv 2020，`strict: true`、`allErrors: true`、`useDefaults: true`：schema 里的 `default` 会在校验时回填进文档。
- 校验失败抛 `ConfigValidationError`，错误信息会指出具体路径和冒名的键（`additionalProperty: xxx`）或合法枚举值。
- 子插件的 `instanceKey` 若与父插件自己 schema 的某个属性同名，抛 `ConfigSchemaCollisionError`。

## ConfigView：按 owner 投影

插件**不会**拿到自己在文档里的整棵子树（那里面还有它的后代）。`ConfigComposer` 用 `pickOwnFields` 按每个包自己的 schema 挑出顶层属性，冻结后作为该插件的 `ConfigView`：

```ts
// PluginSetupContext.config
context.config.get(); // 只含本插件 schema 声明过的字段
```

环境变量插值（`${VAR}`）在投影时展开；未设置的变量展开为空字符串。密钥一律走环境变量，不要写进 yaml。

## 适配器配置模型：顶层共享 + `endpoints[i]`

多账号适配器（一个插件实例挂多个平台连接）用 `endpoints` 数组声明。展开规则实现在 `AdapterIndex`（`packages/im/adapter/src/adapter-index.ts`）：

```yaml
plugins:
  icqq:
    commandPrefix: "/"          # 顶层：所有 endpoint 共享
    endpoints:
      - name: bot-a
        uin: ${ICQQ_UIN_A}
      - name: bot-b
        uin: ${ICQQ_UIN_B}
        commandPrefix: ""       # 逐项覆盖顶层
```

- 每个 entry 的生效配置 = 实例配置（去掉 `endpoints` 键）**合并** entry 自己的字段；`name` 必填。
- 展开后每个 endpoint 是独立记录，能力 id 形如 `<slot>~<name>`，Console 和消息链路按 name 寻址。
- entry 缺 `name`、name 含 `~` 或 `\0`、name 重复：该项被丢弃并告警；全部无效时退化为单 endpoint。
- `endpoints` 为空/缺省时按实例配置创建单个 endpoint。

### commandPrefix

命令前缀默认按消息所属的适配器实例解析（`defaultCommandPrefixResolver`）：

1. 消息带 `metadata.endpoint` 且配置里有同名 `endpoints[i]` → 用该 entry 的 `commandPrefix`；
2. 否则用实例顶层的 `commandPrefix`；
3. 都没有 → `''`（无前缀，任意文本都尝试按命令匹配）。

## 配置文档事务与回滚

运行时改配置（Console 界面、`patchConfig` API）不是直接改文件，而是一个两阶段事务，接口是 `ConfigDocumentPort`：

```ts
interface ConfigDocumentPort {
  read(): Promise<ConfigDocumentSnapshot>;           // 文档 + revision（内容 sha256）
  prepare(current, patches): Promise<PreparedConfigDocument>; // 候选文档，此时是惰性的
}
interface PreparedConfigDocument {
  commit(): Promise<ConfigDocumentSnapshot>;
  rollback(): Promise<void>;
}
```

`YamlConfigDocument`（`@zhin.js/config-yaml`）的实现要点：

- **乐观并发**：`prepare` 和 `commit` 都会重读文件并核对 revision；文件在读取后被外部改动则抛 `ConfigDocumentConflictError`。
- **保格式**：patch 应用在 YAML AST 上再 stringify，注释与缩进风格（含 CRLF）保留；路径段里的数字寻址数组元素（`endpoints.0.url`），`__proto__` 等危险段被拒绝。
- **原子落盘**：`commit` 先写临时文件再 `rename` 替换，保留原文件权限位。
- **一致性**：候选文档与运行时校验过的候选不一致时抛 `ConfigDocumentDivergenceError`，宁可失败也不写分歧配置。

事务被编入 generation 交接：`RootRuntime.patchConfig` 先走影子 prepare（见 [generation 与生命周期](./generation-lifecycle.md)），文件 commit 发生在新一代资源激活之后；若交接失败，回滚顺序相反——先恢复文件，再停用影子代。任何一步失败，磁盘上的 `zhin.config.yml` 和内存里的运行时都不会出现半更新状态。

外部直接编辑配置文件也可以：配置文件本身被 watch，外部修改会触发一次全量重载，以磁盘内容为准。
