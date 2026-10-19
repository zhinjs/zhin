---
title: 插件包契约与实例声明重整计划
sidebar: false
---

# 插件包契约与实例声明重整计划

状态：**实现与本地验收完成；浏览器实操保留未验证限制，交付审阅。** 2026-10-19 补充决定：直接破坏性更新，Runtime 不保留旧格式运行；提供显式迁移 CLI 与迁移指南。

源码梳理和并行设计已完成，当前按用户最终确认的扁平模型实施。本计划不授权迁移真实用户 workspace、启动 Bot、读取凭据或发送平台消息。

## 1. 要解决的问题与推荐决策

目前应用挂载在 `package.json#zhin.plugins`，业务配置在主配置，停用状态另存 lifecycle 文件。包级契约、应用装配和运行状态混在多处；同包多实例虽然已经可用，但配置、管理和嵌套表达不够统一。

推荐定稿为：

1. **包描述“这个包是什么、运行需要哪些框架能力”；应用描述“创建哪些实例、配置什么、是否启用”。** 保留 `zhin.features` 等包契约，不用新增字段填满 `zhin`。
2. **正式应用声明放在现有主配置单文档。** 用显式 `configVersion: 2` 选择新格式；采用用户提出的扁平结构：`plugins` 是实例到包的映射，`disable_plugins` 是停用列表，业务参数放在顶层同名实例块。已有 YAML/JSON 是同一模型的序列化形式，不保留另一套包装语法。
3. **v2 的具体实例树只有应用声明一个权威。** 能够保持直接实例身份的声明由显式工具迁移；嵌套或解析 owner 变化不能无损处理时拒绝自动转换。v2 不再读取包内历史挂载创建实例。Feature 需求仍由包声明。
4. **直接切换新格式。** Runtime 只接受 configVersion 2，旧配置必须迁移后启动；旧输入解析仅存在于显式迁移 CLI，不保留旧格式运行分支。用户已明确授权该破坏性变化，发布门禁仍保持，changeset 如实记录迁移要求。
5. 本期新增包级信息仅推荐可选 `zhin.metadata.displayName/icon`；不同时重做 typed Schema、Token、权限和单例协议。

### 本轮已执行的研究分工

| 负责人 | 核验内容 | 交付与状态 |
| --- | --- | --- |
| 包契约 agent | manifest、Feature/API、Schema、Token、元信息、旧 Runtime 兼容性 | 已完成源码核验与字段归属建议 |
| 实例声明 agent | 文件选择、启停、多实例、嵌套、身份、路径、固定组合 | 已完成候选比较与语义设计 |
| 工具链 agent | Runtime/HMR、CLI、Console、脚手架、迁移、回归落点 | 已完成影响面与实施依赖清单 |
| 主 agent | 统一术语、解决方案冲突、整合验收、组织交叉审阅 | 负责冻结契约、集成与非作者交叉审阅 |

## 2. 包里保留什么，应用里声明什么

| 信息 | 权威位置 | 本期决定 |
| --- | --- | --- |
| 包名、版本、描述、作者、许可、仓库、关键词、依赖、Node 要求、发布文件、库导出 | npm 标准 `package.json` 字段 | 直接复用；不复制成 `zhin.description/dependencies/exports` 等 |
| `zhin.protocol/type/entry` | 包 manifest | 保留；Zhin 插件入口与 npm 库入口不同 |
| `zhin.engine` | 包 manifest | 保留，表示 Runtime ABI 范围，不等于 npm 包版本或 `engines.node` |
| `zhin.features[].package/api/optional` | 插件包 manifest | 保留，决定 Feature provider 准入、发现与装配；npm 安装依赖不能替代它 |
| `zhin.featureApi` | Feature 包 manifest | 保留，表示 Feature 提供的 API 版本 |
| `zhin.platformFeatures` | 包 manifest | 保留现有平台 Feature 默认策略；应用运行不保留 v1 分支，v2 不由此注入子实例 |
| `zhin.runtime` | 包 manifest | 保留现有执行模式契约；包自报 `trusted` 不得解释为新获得网络、执行或密钥授权；不借本期更改安全默认值 |
| `zhin.metadata.displayName/icon` | 包 manifest，可选新字段 | 支持停用/未加载时展示；只放没有 npm 标准对应的包级静态信息 |
| `definition.name` | `definePlugin()` | 保留现有必填 slug；不同于 scoped npm 包名，也不同于实例身份 |
| `definition.config` / 根 `schema.json` | 现有互斥作者模式 | 保留；不引入新的手填 Schema 指针或构建生成协议 |
| `definition.requires` | 代码中的 typed Token | 保留，继续由 Scope/Token 校验；不新增手填字符串 `zhin.requires` 替代它 |
| `definition.metadata.order` | 现有代码元信息 | 暂保留，属于展示信息；不搬成包级执行顺序 |
| 实例名、引用包、配置、启停、具体子实例 | 应用 v2 主配置 | 直接实例采用下节扁平声明；首版仅 Root 直接实例、启用引用均为必需包；不再写新格式项目的旧 manifest 挂载或 lifecycle |
| `instancePolicy/singleton/maxInstances` | 可能的包级准入契约 | 本期暂缓；先区分不可重入的是插件实例、账号还是端口/资源，再决定是否需要 |
| 分类、权限清单、资源字符串目录、任意 capability DSL | 未新增 | 不为未来消费者预埋重复字段 |

### metadata 的唯一来源规则

新 manifest 只接收 `displayName/icon`。按字段检查：manifest 与旧 `definition.metadata`（或 isolated descriptor）同时声明同字段时，即使值相同也报冲突；不设隐式覆盖优先级。旧代码单独声明继续有效，新作者可逐字段迁移，无需双写。`order` 仍走旧代码路径。

未加载时只能完成静态展示，代码侧是否重复声明要在运行加载后验证。metadata 修改必须进入 generation/Console 刷新计划，不能只扩展 parser。旧 Runtime 忽略新展示字段时可回退包名，因此无需为展示字段统一抬高所有包的 engine。

### Schema 的实际验证能力

JSON 作者模式使用现有根 `schema.json`，可静态读取；inline 模式使用当前入口的 `config.toJsonSchema()`，读取可能执行模块。两者共存仍报错。停用插件不得为获得 Schema 而导入入口；inline Schema 静态不可得时，显示“待 Runtime 校验”，允许原文编辑，不展示陈旧表单。

Runtime 与 Console 共用同一 generation 的声明投影。复杂 JSON Schema 超出表单支持时明确回到原文编辑；这不表示 Runtime 支持任意 Schema，最终仍须通过现有 ConfigComposer 的校验/投影约束。typed Schema 静态生成、产物摘要和开发/发布优先级需要另期完整设计，本期不承诺。

## 3. 为什么选主配置单文档

| 方案 | 收益 | 成本与决定 |
| --- | --- | --- |
| 现有主配置内声明实例及配置 | 一处审阅装配和启停；复用 ConfigDocument、单文件 revision、Console 原文编辑 | 文件更长，但最少引入新机制；**推荐** |
| 单独 `zhin.plugins.*` 保存全部实例数据 | 装配独立，适合单独管理权限 | 需要定义跨 Host/实例文档快照、并发提交、Console 多源协议；本期不选 |
| 每实例文件、include 或多文件浅合并 | 大项目可分工 | 增加解析/路径/冲突/删除/事务规则；暂无足够需求，不选 |

选择主配置是基于现有单文档能力，而非预设只能用 `zhin.config.yml`。继续沿用已有配置文件选择与格式适配器；不同时自动发现多个实例文件再合并。将来确需拆分时，先设计多文档 Interface，不加隐式 include 补丁。

## 4. 用户提出的扁平格式与语义（本轮修订）

按用户最新意见，采用同一主配置中的三处结构：`plugins` 只映射实例名到包引用，`disable_plugins` 记录停用实例，各实例的业务配置直接放在同名顶层键。撤回此前 `{ package, enabled, config, plugins }` 包装模型；不同时支持两种 v2 语法。

以下是本分支实现的格式；用户升级到包含该变更的版本前不可直接使用。业务字段来自现有 reminder Schema。

```yaml
configVersion: 2
# 原有 Host、AI、数据库等配置继续放在既有顶层键
plugins:
  reminder: '@zhin.js/plugin-reminder'
  work-reminder: '@zhin.js/plugin-reminder'

disable_plugins:
  - reminder

reminder:
  timezone: Asia/Shanghai
  maxTasks: 20
  maxTasksPerSender: 10
  batchSize: 5
  missedGraceSeconds: 15

work-reminder:
  timezone: UTC
  maxTasks: 5
```

示例中 reminder 已声明但停用；work-reminder 启用。两者使用同一包、不同实例身份和配置。新建、停用与删除是三个动作：增加声明创建实例，加入 disable_plugins 停用，移除声明删除实例；删除配置必须在操作中明确说明，不能把停用当删除。

| 位置 | 缺省与校验 | 含义 |
| --- | --- | --- |
| `plugins` | 缺省空映射；key 沿用 instanceKey 格式；value 为非空 npm 包名或合法 `./` 路径 | 包引用与实例名；不在同一 value 里混合对象包装 |
| `disable_plugins` | 缺省空列表；值必须精确匹配已声明实例；重复项/未知项报错 | 未列入者默认启用；列表顺序不决定 setup 顺序 |
| 顶层 `<实例名>` | 缺省 `{}`，业务对象 | 当前实例的配置值；由该包 Schema 验证，插件 ConfigView 只收到此对象 |
| 顶层 `plugin` | 保留现有 Root 业务配置 | Root 不加入 plugins，也不能通过 disable_plugins 停止 Root |

实例声明是索引权威：有业务块却没有对应声明属于 orphan，诊断并拒绝，不按块名猜包或自动启用。已声明但缺业务块按 `{}` 应用其 Schema 默认值；启用后缺必填字段仍失败。停用实例允许保留未填写完整的业务对象，不为获得 Schema 而导入入口。

### 顶层重名必须明确拒绝

扁平模型让 Host 与实例配置共享命名空间，不能再承诺任意旧别名无损迁移。新 v2 实例别名不得与实际 Host 键、框架结构键或对象安全保留键重名。当前保留集合由 `HOST_CONFIG_KEYS` 加 `configVersion/plugins/disable_plugins` 与 `__proto__/constructor/prototype` 推导，不另手写会漂移的 Host 清单。

例如 `ai`、`database`、`plugin` 已有顶层用途，应改用明确的非冲突实例名。旧项目必须先迁移；迁移碰撞时**停止自动 apply**，不能静默改名、吞掉配置或混合两份数据。若用户决定重命名，须另行审阅 PluginId/持久化 owner 的迁移映射。`root` 本身不是实际顶层保留键，可继续作为子实例名，canonical ID 为 `root/root`。

### 身份、解析与顺序

- 保留 canonical PluginId：Root 为 root，直接子实例为 `root/实例名`。同包不同别名有各自 ConfigView、资源和生命周期，包名不能替代实例地址。
- 改业务配置、启停、更新包版本不改 ID。改名或重父化视为删除/新增；相同 ID 换包需重建受影响子树，不承诺旧业务状态自动兼容新实现。
- Adapter 多账号 `endpoints[].id` 与插件多实例仍是两个维度。顶层业务块传给插件后，内部字段即原 `timezone/maxTasks/endpoints` 等，无额外 config 包装。
- Root 直接子实例的 `./` 相对 Root 包根；不相对配置文件路径。不放宽现有祖先包循环与同名包多物理根约束。
- setup 按 plugins 映射的源顺序，业务块顺序及 disable_plugins 顺序不影响它。所有 v2 parser/writer 必须保留有序条目，包括数字实例名 `10、2`；不得因只改 Host/业务块而被 JSON.parse/stringify 重排。重复键与有序读写由配置文档层校验；应用 Runtime 只接受 v2。
- 准入/Schema 校验先于实例 setup；inline Schema 读取可能执行模块，不能承诺任意入口零副作用。候选失败保留旧 generation，清理其拥有资源；外部副作用不伪称可回滚。

### 首版明确的能力范围

首版只提供 Root 直接实例，不引入嵌套路径 DSL 或逐挂载 optional 语法。旧嵌套树不能自动压平，迁移时明确拒绝；人工拆为根实例前须处理父 Scope、依赖解析和持久化 owner 的变化。旧 optional 引用需人工明确选择必需包或停用实例，工具不能把二者假装等价。没有旧 Runtime 兼容回退，无法转换的旧项目在处理完成前不得启动。

## 5. 版本、固定组合与迁移

| 输入情况 | 行为 |
| --- | --- |
| configVersion 缺失或不是 2 | 明确拒绝启动，指向迁移指南，不尝试旧格式 |
| configVersion: 2 | plugins/disable_plugins/同名业务块是唯一运行权威 |
| Root manifest 非空旧 zhin.plugins | 要求显式迁移，不偷偷合并 |
| 依赖包仍含历史 zhin.plugins | 不据此实例化；显式迁移工具检查旧组合是否无法自动转换 |
| 旧 lifecycle 状态 | 显式迁入 disable_plugins 后退役，不作为运行时启停来源 |

应用格式版本与包 manifest protocol、Runtime engine ABI、npm 版本是独立坐标。保留插件作者的 definePlugin/config/requires Interface，本次破坏性更新针对应用装配与配置载体。旧解析仅存在于 `zhin migrate instances`，不会被 Runtime 自动调用。

包内不可分割实现继续使用 helper/现有能力机制；具体子实例由应用显式声明。平台 Feature 继承保留，facade 不隐式注入插件。组合包的旧嵌套树需要显式处理，不在迁移时自动改变身份。

迁移文档见[迁移到扁平插件配置](../migrations/plugin-instance-declarations.md)。

### 为什么本期不加单例字段

现有多实例已支持，表达与管理才是本期问题。没有证据说明任意重复包都应禁止，多账号也不等于插件不可重入。暂不发布 `instancePolicy`。

如后续确需增加限制，必须明确按 Root/父节点计数、停用是否计数、约束的包身份，并为旧 Runtime 建立拒绝路径。旧 parser 会丢弃未知字段，单加 `single` 会静默失效；可以另行通过 engine 能力下界加发布门禁实现执行前拒绝，但本期不为假设需求升级 ABI 或预埋字段。

## 6. 统一读取与运行提交

采用一个归一化的只读声明快照 Interface：记录文档 source/format/revision、协议、有序实例条目及完整地址、包引用与解析 owner、enabled/optional、未展开 raw config、字段来源位置。Runtime、CLI 和 Console 只消费新模型，不各自推断拓扑。旧输入仅由离线迁移模块读取。

处理顺序固定为：

1. 读取输入快照并选择协议，结构校验与来源冲突检查。
2. 根据候选启用树解析包、验证 engine/Feature 契约，构建候选 graph。
3. 用**候选 graph**动态组合根 Schema：Host/框架结构键加已声明实例的同名业务块；启用实例用包 Schema，停用块仅校验业务对象结构。ConfigView 从 `document[实例名]` 投影；环境替换与默认值只进运行投影，不写回 raw 文档。
4. 分类纯配置、拓扑、Host/env、Feature/物理依赖变化，复用现有 subtree/topology/restart 机制。
5. 准备候选 generation；通过 revision 检查与既有 handoff 提交。失败维持旧运行状态；候选资源按生命周期释放。

目前 `RootRuntime.#reloadPlan` 先用旧图规划新配置，新增实例可能在重建拓扑前被旧 Schema 拒绝，这是必须修正的顺序。文件 watcher、Console 原文替换、结构 patch、CLI 启停均须覆盖，不能只修其中一条路径。

API 受控提交可先 prepare 再写文档；外部编辑已经改变磁盘，无法声称磁盘与运行状态始终原子一致。Console 分别显示“已保存/待应用/已应用/应用失败/需重启”，以实际 committed generation 为准。失败后不覆盖用户新编辑，也不因 watcher 再次触发重复应用。

v2 的结构写入路径固定为：业务值写 `[实例名, ...业务字段]`，包引用写 `['plugins', 实例名]`，启停写 `['disable_plugins']`。Console 当前 flatten 将 plugins 的值当业务配置处理，不能直接用于新的包字符串映射，必须消费统一投影后再编辑。

## 7. 显式迁移与故障恢复

迁移采用**离线 plan → 审阅 diff → 显式 apply**；不默认启动进程，不与正在写配置的 Bot 并发操作，不隐式升级 latest 或修改其他依赖。复用 CLI 现有 migrate 入口体系，但声明迁移必须是独立可选操作，不能绑在通用升级上自动执行。

### plan 必须产出

- 读取有效旧树，包含嵌套包、平台继承、默认或显式选择的 lifecycle 文件；逐节点保存原 canonical PluginId、解析 owner 与目标配置路径。
- 旧 `plugins.<实例名>` 业务值原样移到主文档顶层 `<实例名>`；旧包引用写入新的 plugins 映射。先检查顶层保留键碰撞；遇到嵌套树或字段归属不明、orphan config/disabled 无法绑定时只出诊断并阻止 apply，不猜测、改名或删数据。
- 旧 disabled 映射到 disable_plugins；缺包的 optional 引用不能因未进旧 graph 丢失，本次格式不支持逐引用 optional，因此阻止自动 apply。旧 child 引用若含当前无准入语义的 api，单列诊断并阻止自动 apply，不能悄悄删除或伪称仍生效。
- 保留 `${VAR}` 字面量、未知用户值、null/false/空数组区别、注释和现有 key 顺序；不读取秘密值、不物化 defaults。JSON/YAML 重复 key 拒绝；复杂 alias/merge 无法证明无损时只输出诊断，不降级 parse/stringify。
- 固化跨 facade/父包解析差异；需要补应用直接依赖时，只提出保持原 specification 的明确 diff，不静默换版本/来源。现有 Feature、workspace/link 依赖和用户 scripts 保留。
- 输出所有源文件 revision/hash、目标 diff、身份/停用映射、静态验证结果及“待入口加载校验”项。没有执行第三方入口的 plan 不得宣称已完成 inline Schema 或业务验证。

### apply 与恢复的交付要求

ConfigDocument 的 rename/revision 仅保证**单文件**，不等于 package/config/lifecycle/lockfile 跨文件事务。迁移 apply 首期就必须有可恢复的离线 cutover：同一项目锁、原文备份、带源/目标摘要和阶段的 journal、所有目标预检查、逐阶段写入及精确恢复。journal 未完成时启动拒绝半迁移状态，提示继续或回滚；不得自动混合新旧输入。

离线 apply 与 plan 使用同一静态验证等级，不导入第三方插件入口、不运行 setup，也不借用完整 generation prepare 来打开连接。planner 禁止调用带模块加载器的 `readPluginConfigSchema` 或任何 GenerationPreparer；可共享 P2 的纯结构/图/包契约校验，但 inline Schema、Token 可用性及运行装配仍列为下次受控启动的待验证项。迁移完成只表示文件切换完成。Schema 或运行装配下次失败时报告失败阶段，不自动重新安装、启用或发送测试消息。

恢复/回滚必须再次比较实际 revision，不覆盖迁移之后的用户修改；结果未知时先核对文件和阶段，不盲目重跑。receipt/journal 不包含展开的凭据或配置值，原文备份使用受限权限。注释无法无损移动或源文件变动时在写入前失败。现有 writer 没有这些整体保证，需通过崩溃注入证明后才能开放自动 apply。

常规安装同样区分“依赖安装、声明提交、候选应用、平台就绪、业务检查”。包管理器成功后 Runtime 失败可以留下已安装但未启用的包；不把删除依赖当成可以无条件重试的回滚。卸一个实例要扫描全部声明（含停用实例）及其他包级 Feature 引用后再决定是否可以移除依赖，不能只看 Root 同包计数。

## 8. 确认后的实施顺序与 agent 分工

每个阶段围绕可验收目标组织提交/PR；不得让 writer 提前输出尚无 reader 的新格式。表中是依赖顺序，**不是已经完成的实现清单**。

| 阶段 | 负责人/范围 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| P0 契约冻结与迁移样本 | 主 agent + 契约 agent；本方案确认、代表性旧树/多实例/组合样本 | 用户确认本文 | 冻结用户扁平模型、顶层保留键及碰撞迁移策略；首版仅直接实例与required引用，嵌套/optional拒绝自动迁移，来源/版本/身份无歧义；冻结支持迁移版本及最低新版本、默认/自定义输入支持矩阵；列出真实旧消费路径与预期映射，不启动真实 Bot |
| P1 统一声明输入与只读 planner | 契约/迁移 agent；runtime 输入、config-file 有序解析/写回、source/revision | P0 | 唯一 v2 解析与三源迁移 dry-run 共用模型；普通 patch 保持数字 key 源序；缺项/冲突诊断与身份映射准确；尚不切换默认模板 |
| P2 Runtime 完整候选链路与包元信息 | Runtime agent；graph/composer/input planner/topology/HMR/patch/metadata | P1 | 所有入口先新图后校验；启停/配置同批；失败留旧 generation；保留作者 API 与 Feature 物理唯一性 |
| P3 迁移 apply/恢复 | 迁移 agent；CLI 独立迁移操作、AST 移动、backup/journal | P1、P2 | plan/apply 同候选；中断可恢复；外部 revision 冲突拒绝；无注释/身份/disabled 丢失；明确要求用户停止 Bot 后 apply，检测已知 .zhin.pid；不宣称能自动识别所有前台进程 |
| P4 CLI 全入口收敛 | CLI agent；workflow/install/packages/uninstall/config check/devlink | P2，迁移入口依赖 P3 | 同一实例寻址与 writer；修复旧卸载先删配置及 adapter 旁路；多实例歧义零写入；检查不隐式迁移 |
| P5 Console 协议与界面 | Console agent；catalog/projection/configuration/lifecycle/client | P2，可与 P4 并行 | 完整 PluginId 与 config 路径；Host 同名无歧义；停用/未解析/待应用/已应用区分；原文 revision 与结构编辑一致；旧 client 支持矩阵与能力协商回归通过 |
| P6 创建与文档全路径 | scaffold/docs agent；wizard/create/new/examples/生成文档 | P3–P5 联验 | 新建和 setup 只写 v2，旧配置要求显式迁移；不丢 YAML 注释；consumer 创建→安装→命令→HMR→生产重启验证通过 |
| P7 集成审计与最终验收 | 主 agent + 非作者 review agent | P1–P6 | v2 无旧源旁路；旧配置拒绝启动和显式迁移 fixture 齐全；受影响包 patch changeset；门禁与真实用户路径证据齐全 |

并行时最多同时安排契约/迁移、Runtime、CLI/Console 三个独立工作面，主 agent 负责接口冻结与集成。P4/P5 可以先基于冻结 fixture 开发，但不得自己发明第二套解析器。共享 graph/protocol 文件指定一个 owner；非作者 agent 交叉 review，主 agent 验收后再提交。

若 Console 前端位于独立仓库，P5 必须配套兼容协议与对应 UI 变更，不能以本仓库类型检查代替前端操作证据。发布、部署、合并、真实用户配置迁移均不包含在“确认后改代码”的默认范围中。

Console 旧 client 到新 Host 的无歧义 Root/直接实例业务操作保持兼容并回归；本期不新增嵌套 RPC。不能表示的操作明确拒绝，不把短名猜成路径，也不让旧表单误写 plugins 包映射或 disable_plugins。

## 9. 验收矩阵

| 场景 | 必须证明 |
| --- | --- |
| 协议兼容 | 旧配置拒绝启动；应用 Runtime 不存在旧格式运行分支；作者 API 保留；未知版本/旧挂载冲突明确拒绝；迁移旧输入只由显式 CLI 读取 |
| 多实例/嵌套 | 同包不同别名的配置/资源隔离；停 A 不影响 B；根子实例 root 可用；ai/database 等实际顶层碰撞拒绝且不自动改名；旧嵌套明确拒绝自动 apply；不静默压平或改身份 |
| 停用/optional | disable_plugins 精确寻址、无未知/重复条目；停用保留业务块且零入口导入/setup/连接；旧 optional 引用拒绝自动迁移并说明新语义；恢复完整校验 |
| 解析与 Feature | local/npm/父包 owner 一致；循环及多物理根拒绝；Feature missing/optional/API 不兼容；provider 按既有物理唯一约束装配 |
| HMR 与提交 | 新实例+config、换包+新 Schema、启停+不完整配置同批处理；API patch 与 watcher 一致；候选失败和 revision 冲突不破坏旧服务/用户编辑 |
| 迁移文本与状态 | 原 PluginId/state address 一致；所有 disabled 保留；`${VAR}`、注释、CRLF、null/false、未知值保留或写前明确拒绝；全部 writer 只改 Host/config 时保留数字实例源序及原拓扑；中断每阶段可恢复/拒绝覆盖 |
| CLI 管理 | 包名多实例歧义零写入；adapter 无旁路；移除实例不误删其他实例/Feature/包引用；停用不卸包 |
| metadata/Schema | 旧代码来源仍可用；同字段双写失败；metadata HMR 刷新；停用 inline 显示待验证；JSON/inline 互斥；不支持表单不伪造部分内容 |
| Console | 浏览器实际操作两个同包实例的配置/启停、原文冲突和失败状态；首版不提供嵌套声明；旧 client→新 Host 兼容与不支持操作拒绝；后台测试不替代浏览器证明 |
| 新建与发布产物 | 本地 TS 开发与 packed JS 消费者分别通过；新建→安装→命令→HMR→production restart；不使用真实 QQ 登录/发消息充当确定性测试 |

### 分阶段命令

以下为分阶段验证命令；实际通过范围见本文末尾验收记录。先做对应局部回归，再跑集成门禁。

```sh
# P1/P2：输入、候选图、配置、HMR、代级持久化
pnpm exec vitest run packages/im/runtime/tests/project-graph.test.ts packages/im/runtime/tests/config-composer.test.ts packages/im/runtime/tests/package-resolver.test.ts
pnpm exec vitest run packages/im/runtime/tests/runtime-input-hmr.test.ts packages/im/runtime/tests/config-patch-runtime.test.ts packages/im/runtime/tests/topology-runtime.test.ts packages/im/runtime/tests/owner-scoped-hosts.test.ts
pnpm exec vitest run packages/im/config-file/tests

# P3/P4/P5：新增迁移/崩溃注入 fixture 同时加入相应测试目录
pnpm exec vitest run basic/cli/tests/plugin-management.test.ts basic/cli/tests/plugin-management-review.test.ts basic/cli/tests/install.test.ts basic/cli/tests/packages.test.ts basic/cli/tests/config-check.test.ts basic/cli/tests/dev-link.test.ts scripts/zhin-local.test.ts
pnpm exec vitest run basic/cli/tests/plugin-runtime

# P6：用户创建/向导与发布消费路径
pnpm --filter @zhin.js/scaffold-wizard test
pnpm --filter create-zhin-app test
pnpm exec vitest run basic/cli/tests/new-integration.test.ts basic/cli/tests/setup-save.test.ts tests/docs/first-plugin-runtime.test.ts
pnpm --filter @zhin.js/scaffold-wizard build
pnpm check:plugin-scaffold
pnpm check:created-project

# P7：受影响文档/架构/发布契约，最后整体门禁
pnpm check:config-docs
pnpm check:config-reference
pnpm check:doc-links
pnpm check:runtime-config-boundaries
pnpm check:architecture
pnpm check:plugin-capability-publish
pnpm check:plugin-runtime-api
pnpm check:release-plan
pnpm check:all
```

包打包/安装测试需要可用依赖和网络环境；默认 consumer Sandbox 证明不等于 QQ/Telegram 实机或生产证明。最终报告分别列静态/单测、packed consumer、浏览器、CI 及未验证实机场景，不把“已保存配置”写成“平台业务成功”。

## 10. 源码依据与评审入口

- 包协议与版本：[manifest](../../packages/im/runtime/src/manifest.ts)、[package-contract](../../packages/im/runtime/src/package-contract.ts)、[发布兼容政策](../contributing/development.md)。当前 parser 会丢弃未知包字段，不是全部未知字段都严格拒绝。
- 图、解析与继承：[project-graph](../../packages/im/runtime/src/project-graph.ts)、[package-resolver](../../packages/im/runtime/src/package-resolver.ts)、[platform-features](../../packages/im/runtime/src/platform-features.ts)。
- 作者契约：[PluginDefinition](../../packages/im/plugin-runtime/src/plugin.ts)、[Token](../../packages/im/plugin-runtime/src/token.ts)、[Schema reader](../../packages/im/runtime/src/plugin-config-schema.ts)、[配置组合](../../packages/im/runtime/src/config-composer.ts)。
- 候选提交：[RootRuntime](../../packages/im/runtime/src/root-runtime.ts)、[RuntimeInputPlanner](../../packages/im/runtime/src/runtime-input-planner.ts)、[TopologyGenerationPreparer](../../packages/im/runtime/src/topology-generation-preparer.ts)、[ConfigFileDocument](../../packages/im/config-file/src/config-file-document.ts)。
- 管理和展示：[lifecycle store](../../basic/cli/src/plugin-runtime/plugin-lifecycle-store.ts)、[workflow](../../basic/cli/src/plugin-management/workflow.ts)、[旧卸载入口](../../basic/cli/src/commands/uninstall.ts)、[Console Schema catalog](../../basic/cli/src/plugin-runtime/console/plugin-schema-catalog.ts)。
- 创建与迁移：[wizard apply](../../packages/toolkit/scaffold-wizard/src/apply.ts)、[create workspace](../../packages/toolkit/create-zhin/src/workspace.ts)、[CLI migrate](../../basic/cli/src/commands/migrate.ts)。`migrate instances` 为独立实例迁移入口，不与普通依赖升级隐式绑定。

用户已确认第 1 节扁平格式和直接破坏性更新，P0–P7 按此范围实施。若调整主配置位置、包内组合归属或兼容策略，应先改本文和 fixture，再开始相应实现；不在实施途中以局部修补悄悄改变公共契约。

## 11. 本轮设计验收记录

- 上一版包装模型曾完成三位 agent 交叉审阅；本轮按用户意见改为扁平模型，上一版“无剩余阻塞”结论不自动覆盖新版。保序 writer、旧 Runtime 支持矩阵及离线验证等要求仍保留。
- 本版按用户最新授权直接切新格式；旧嵌套/optional不自动转换，CLI提供预览/受控转换/故障恢复。
- 框架、迁移 CLI 与交叉审计已完成；真实用户 workspace、Bot 与凭据保持未操作。
- 设计阶段文档检查已通过；当前实现验证记录以最终测试报告为准，不把设计审阅当成实现通过。


## 12. 实现验收进度

- Runtime、ConfigDocument、CLI/Console、scaffold/create 与仓库示例已切换 v2；旧输入仅由显式迁移入口转换。
- 迁移默认只预览，apply 保留受限权限备份与 journal；已验证逐文件中断 continue/rollback、外部编辑拒绝、原权限和原文保序。不能无损处理的 nested/optional/collision 明确拒绝。
- packed consumer 验收通过：空项目创建、候选 tarball clean install、迁移/依赖重装保留用户文件、Sandbox readiness、/hello、Console JSX preview、TSX 与命令 HMR、production restart。
- `HARNESS_SKIP_TEST=1 pnpm check:all` 已通过（单测另行全仓运行），包含架构、类型、Lint、L4-CI、Stable、发布计划、文档与 IM 安装体积。最终 Runtime 审阅修正后已重新完整通过。
- 最终全仓 `pnpm exec vitest run --maxWorkers=4`：1,191 文件、9,666 通过、0 失败、17 原有 pending（总计 9,683）。并发数限制避免本机多进程冷加载争用，未放宽测试超时或断言。
- normal/service/adapter 三类插件脚手架已完成 packed Vitest、tsc 和发布包入口验收。
- 已打包 CLI 的 `migrate instances` 默认预览、apply、config check 与 rollback 均在独立旧格式消费者通过；入口刻意抛错以证明离线工具不执行插件。
- 非作者审阅已核验 PrimaryConfig 新旧 lease 隔离、排队 reload/HMR 失败恢复、混合 slot/config 更新及无关 Adapter 保留；相关新增回归通过。
- 浏览器实际 Console 操作尚未通过：工具对临时 `127.0.0.1` Host 返回 `ERR_BLOCKED_BY_CLIENT`。已停止合成 Host；后端 Console 协议与消费者 JSX preview 测试不能替代这层证明。本 PR 明确保留该验证限制，不声称 UI 已验收。
- 未合并、发布、部署，未迁移真实用户 workspace、读取秘密值、登录账号或发送外部测试消息。
