# @zhin.js/service-typesafe

## 1.0.29

### Patch Changes

- Updated dependencies [ee51324]
- Updated dependencies [58ce469]
  - @zhin.js/ai@1.9.0

## 1.0.28

### Patch Changes

- Updated dependencies [23eb6ef]
  - @zhin.js/ai@1.8.2

## 1.0.27

### Patch Changes

- @zhin.js/ai@1.8.1

## 1.0.26

### Patch Changes

- f5bf768: 插话判断改由一条判断器链负责切换备用模型（ADR 0066 P0，配置与行为不变）。

  - `@zhin.js/agent` 新增 `EngagementJudgeChain`：一次判断是一次操作，链成员（每个只是一个模型，语言模型或决策模型）按顺序尝试，共用整次判断的 15 秒预算；预算用完或调用方取消时立即停止。选型时跳过模型跳过表里的成员（不计失败），全部在跳过期时记 `judge_failed`（`all_unavailable`）。失败按 ADR 0066 D2 的表切换：配额用完、欠费、凭据被拒换下一个并写全局跳过表；超时、网络错误、5xx 只在本次判断内换，2 分钟内至少 2 次不同判断都这样放弃同一模型才全局跳过 5 分钟（超时与网络 / 5xx 分开计数）；回答无效换下一个但不写跳过表；单纯 403、限流、内容拦截、上下文超长不换。每次切换写 `ambient_judge_fallback` 日志并进入 `recentFallbacks`（`purpose: 'ambient'`）。新增 `createEngagementJudgeMember()`（按 Profile 的模型类型构造语言或决策判断器）、`engagementJudgeFailureAction()`、`engagementJudgeKindOf()`；`FallbackEngagementJudge` 标为废弃并改为链的薄包装。
  - 判断结果的 `source` 改为结构化的 `{ kind, profile, model, fallbackFrom? }`（与第 47 批的 `ref` 相同，`ref` 保留到废弃期结束），显示字符串移到 `sourceLabel`；审计 payload 的 `judge*` 键名不变，改从结构化 `source` 填写。整条链失败时，`judge_failed` 的 `failure.attempts`、`ambient_silent` 结局的 `detail` 和审计的 `judgeAttempts` 列出每个成员的失败类别。语言模型成员不再套用途备用层（`resolvePurposeExecution`），只有判断器链这一层切换；链里每个成员各算一次调用（`[ai.usage] judge`）。
  - `@zhin.js/ai`：`ProviderErrorKind` 新增 `invalid_response`（驱动以 `code: 'invalid-response'` 报告无法使用的回答），`ModelFallbackReason` 新增 `invalid_response`，`ModelFallbackEvent.purpose` 可为 `ambient`；新增导出 `classifyFallbackFailure()`。
  - `@zhin.js/service-typesafe`：请求失败保留 HTTP 状态、`Retry-After` 与响应体的错误码（不含正文），连接失败标为网络错误，SDK 超时标为 `timeout`，`classifyProviderError` 可以据此分类。

- 8c0d262: 插话判断（ADR 0066）审查修复：yml 的「只观察」和门槛在所有路径上都不丢，回退能完整还原。

  **BREAKING（已批准的 minor）与迁移路径**

  - `EngagementJudgment.source` 由字符串改为对象 `{ kind, profile, model, fallbackFrom? }`：读显示文字改用 `sourceLabel`，判断模型类型改用 `source.kind`，按模型分组改用 `source.profile` / `source.model`。无法在不破坏类型的前提下同时保留字符串；`ref`（与 `source` 同一对象）和字符串 `fallbackFrom` 保留到废弃期结束。`EngagementJudgeCall` / `EngagementJudgeFailure` 的字符串 `source` 不变。
  - `DecisionPurpose`、`InferencePurpose` 的 `decision:ambient`、`DecisionTask` / `DECISION_TASKS` 去掉 `ambient`：改用 `PurposePolicy.ambient`（插话判断）。存储里的旧 `decisions.ambient` 仍会读取并自动迁移。
  - 联合类型新增成员：`PurposeIgnoredReason`（`ambient-not-configured` / `no-conversations` / `mode-off`）、`ProviderErrorKind` 与 `ModelFallbackReason`（`invalid_response`）。对这些类型做穷举（`switch`、`Record<…>`）的代码需要补上分支。

  **行为变更**

  - 判断结果没有 `gate`（自定义判断器）时，`AmbientEngagement` 回退读已废弃的 `ai.trigger.ambient.minConfidence` / `mode`，不会比以前多插话；直接构造 `DecisionEngagementJudge({ policy: { minConfidence } })` 时仍在判断器内按它把关（判断器链不设，门槛只判一次）。
  - 迁移完成后再写 `ai.trigger.ambient.mode` / `minConfidence`（旧版 Console、手工编辑、导入的配置）会在下次加载时转到 `purposes.ambient`，记 info 日志 `ambient_trigger_write_converted`，不再静默失效。
  - 空库首次启动从 `ai.plan.yml` seed 的 `purposes.ambient`，以及旧键仍生效时（未迁移、迁移失败、已回退）写入的 `purposes.ambient`，都会补上 yml 里仍生效的 `mode` / `minConfidence`；管理视图、`purposeEffects`、导出和插话状态按实际生效的值显示。
  - 废弃期内的旧写法：`purposes.decisions.ambient` 的 `off` / `null` 撤销决策模型与原「仅评估」的对照模型，恢复原来的旁听语言模型；字符串写法 `purposes.ambient: <profile>` 只替换语言模型，保留 `mode`、`compare`、`minConfidence`。
  - `zhin doctor`：只有运行中实例的迁移记录为 `migrated`、键已被迁移读入且值未再改动时，才提示 `ai.trigger.ambient.minConfidence` / `mode` 不再生效并允许 `--fix` 删除；实例未运行、未迁移、迁移失败或已回退时只给警告，拒绝 `--fix`。启动日志 `ambient_trigger_keys_retired` 只在已迁移时出现。
  - `zhin ai purposes revert ambient-judge`：先经配置写锁把迁移读入、之后被删掉的 yml 旧键写回，写不回则不回退并给出手工步骤，回退被拒时撤销写回；旧形状已不成立时拒绝并给出路径。
  - 迁移记录的 `noticedAt` 用 CAS 写入，与回退并发时回退优先。`FallbackEngagementJudge`（已废弃）恢复原有退避：成功清除退避，取消不记退避。插话状态的判断器链读请求所在 generation 的模型配置。判断器链和对照模型使用合并了 generation 停止信号的 `signal`。
  - `@zhin.js/service-typesafe`：失败请求只保留 `Retry-After` 响应头。`@zhin.js/scaffold-wizard`：决策用途检查改为五个，`purposes.decisions.ambient` 提示已废弃。
  - 复审修复：yml 里写回迁移时读入的原值（或已处理过的值）不再被当成新写入，`purposes.ambient` 不变、回退仍可成功；回退命令执行期间在迁移记录上标记 `revertPending`（CAS 写入，10 分钟后失效），期间暂停转换，结束时无论成败都清除。迁移前 seed 过的 `purposes.ambient` 回退时按 D5 表反向换成旧字段，门槛和模式写入 yml；旧版本表达不了的部分逐条列出，此时 CLI 不再提示「可以降级」并以非零状态退出。`zhin doctor` 比较 yml 值时两边都按运行时规则规范化，并按 `triggerSeen` 判断是否已处理。新增路由 `POST {base}/agent/inference/cli/purposes/revert-ambient-judge/pending`（本机 CLI）。
  - 第三次复审修复：旧 Console 先关「只观察」再打开时，写回的原值按新写入转换，最终仍是 shadow（只有存储的插话判断该键仍是迁移写下的值时，原值才不算新写入；`zhin doctor` 同样判断）。回退顺序改为：取得 `revertPending` 标记 → 干跑（`dryRun`，返回 yml 应有的值和旧版本表达不了的项）→ 写 yml（与现有值不同时以当前实际运行的值为准覆盖，并列出覆盖项；写不了就不回退）→ 提交回退（被拒时撤销 yml 写入）→ 清除标记；取不到标记时中止。回退相关路由写审计。
  - 第四次复审修复：回退时如果配置文件里有实例还没转换的旧键写入，拒绝回退（`pending-trigger-writes`，列出键），提示先重新加载实例，避免用迁移原值覆盖新写入；CLI 写入前再按同一规则检查一次文件。已从 yml 转换的门槛 / 模式不阻止回退，回退后按当前值运行。回退请求没有回应时先重读迁移状态再决定保留还是撤销 yml，读不到时不动 yml 并给出手工步骤；提交返回的 yml 与干跑不一致时撤销；撤销失败时列出原值和恢复步骤。回退进行中 `zhin doctor --fix` 不删旧键。
  - 第五次复审修复：回退已提交但返回的 yml 与干跑不一致时，按最终结果更新配置文件并报告已回退（写不进去时列出手工修改的值）；提交无回应时两次查询都仍是已迁移才撤销 yml；因配置文件里缺少已生效的门槛 / 模式而拒绝回退时，提示把哪一项改回什么值后就可以回退。

- Updated dependencies [f5bf768]
- Updated dependencies [5cfb5d7]
- Updated dependencies [8c0d262]
- Updated dependencies [cccf20f]
  - @zhin.js/ai@1.8.0

## 1.0.25

### Patch Changes

- Updated dependencies [f370ec5]
  - @zhin.js/ai@1.7.2

## 1.0.24

### Patch Changes

- Updated dependencies [efa87bf]
  - @zhin.js/ai@1.7.1

## 1.0.23

### Patch Changes

- Updated dependencies [8bf8dfa]
- Updated dependencies [603b892]
- Updated dependencies [07f9d01]
- Updated dependencies [48fdf0d]
  - @zhin.js/ai@1.7.0

## 1.0.22

### Patch Changes

- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

- 70ddaf4: 插件市场元数据（#1250 marketplace-metadata）：`package.json#zhin.metadata` 新增可选的 `descriptionI18n: { 'zh-CN'?, en? }`（本地化描述）与 `category`（`adapter`、`ai`、`admin`、`community`、`entertainment`、`game`、`information`、`moderation`、`service`、`utility` 之一），校验方式与 `displayNameI18n` 相同：只接受这两个语言键、值为非空字符串、分类必须在枚举内。这两个字段只能写在清单里，插件市场才能从发布的 `package.json` 读到。`@zhin.js/plugin-runtime` 导出 `PLUGIN_CATEGORIES`、`PLUGIN_CATEGORY_LABELS`、`informativeKeywords`、`packageAuthorName`、`readPluginMarketplaceMetadata` 等读取工具。

  市场读取侧：`/pub/marketplace/search` 带出 `displayNameI18n` / `descriptionI18n`，分类读声明的 `category`（旧索引的 `util` 等按别名映射），可选 `locale=zh-CN|en` 按语言解析显示名与描述，并按两种语言的名称与描述搜索；`/pub/marketplace/detail/*` 带出发布清单的显示名、描述翻译与分类。作者一律取 `author`（没有时取 `maintainers`），不再显示发布账号——此前 `plugins.json` 生成脚本优先读 `_npmUser`，CI 可信发布的包因此都显示为「GitHub Actions」。keywords 去掉 `zhin`、`zhin.js`、`bot` 等通用词后展示与参与搜索。`zhin search` / `zhin info` 同样显示中文描述、分类和维护者，`zhin info` 不再读不存在的 `zhin.displayName` / `zhin.category`。

  官方插件与适配器：显示名移到 `package.json#zhin.metadata`，补齐中英文描述、分类、3–6 个有信息量的 keywords，author 统一为 `{ name: "lc-cn", url: "https://github.com/zhinjs/zhin" }`（不再发布邮箱）；npm `description` 与英文描述一致。

- Updated dependencies [0e998fd]
- Updated dependencies [5232fd8]
- Updated dependencies [4922472]
- Updated dependencies [b5884b3]
- Updated dependencies [9026329]
  - @zhin.js/ai@1.6.0

## 1.0.21

### Patch Changes

- @zhin.js/ai@1.1.56

## 1.0.20

### Patch Changes

- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [120e225]
  - @zhin.js/ai@1.1.55

## 1.0.19

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/ai@1.1.54

## 1.0.18

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- Updated dependencies [008ccad]
  - @zhin.js/ai@1.1.53

## 1.0.17

### Patch Changes

- Updated dependencies [3a8504b]
- Updated dependencies [bc6ccb1]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
  - @zhin.js/ai@1.1.52
  - @zhin.js/ai-provider@1.0.2

## 1.0.16

### Patch Changes

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [299863a]
- Updated dependencies [9e6d70d]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
- Updated dependencies [d086ff3]
- Updated dependencies [8be6c23]
  - @zhin.js/ai@1.1.51
  - @zhin.js/ai-provider@1.0.1

## 1.0.15

### Patch Changes

- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [3c1912f]
  - @zhin.js/ai@1.1.50

## 1.0.14

### Patch Changes

- Updated dependencies [6749002]
- Updated dependencies [c7944a5]
- Updated dependencies [fc33495]
- Updated dependencies [2c3610a]
- Updated dependencies [4949b90]
- Updated dependencies [4c05a4e]
  - @zhin.js/ai@1.1.49

## 1.0.13

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/ai@1.1.48

## 1.0.12

### Patch Changes

- Updated dependencies [b5071e7]
- Updated dependencies [e23cabc]
- Updated dependencies [3c4178d]
- Updated dependencies [825e4dc]
- Updated dependencies [f1eb75c]
- Updated dependencies [5621f75]
- Updated dependencies [2b8b408]
- Updated dependencies [4d728c0]
- Updated dependencies [f0e1df7]
- Updated dependencies [d9672ec]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [f2bbab5]
- Updated dependencies [1bdbc08]
- Updated dependencies [df6442c]
- Updated dependencies [b223a51]
- Updated dependencies [d0e1fac]
- Updated dependencies [945303c]
  - @zhin.js/ai@1.1.47

## 1.0.11

### Patch Changes

- f3b7c9f: 新增 Console RPC `config:patch`：按路径写入配置，供面向普通用户的简单页面使用（#970）。

  - 路径白名单：带 `instanceKey` 时只能写该插件实例自己的配置块，以及插件 `schema.json` 根部 `x-zhin-config.patchPaths` 声明的 Host 子路径；省略时只能写 `HOST_CONFIG_PATCH_PATHS`（目前为 `ai.trigger.ambient`）。
  - `expectedRevision` 必填；文件已变时返回 `status: 'conflict'` 和最新值，不覆盖。
  - 写入前按 schema 校验每个被改动的配置块；成功响应带 `restartRequired`，`config:updated` 事件新增 `paths` 与 `revision` 字段。
  - `@zhin.js/client` 新增 `patchConfig()`；`@zhin.js/service-typesafe` 声明可写 `ai.decisions`。

  纯新增能力：`config:set`、`config:replace-source` 与 YAML 编辑器行为不变，无需迁移。`config:patch` 只接受 full scope Token，Demo 部署不可用。

- Updated dependencies [ff87195]
- Updated dependencies [a3b636d]
- Updated dependencies [9cade30]
- Updated dependencies [dcd4982]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
- Updated dependencies [f821029]
  - @zhin.js/ai@1.1.46

## 1.0.10

### Patch Changes

- Updated dependencies [0dd657d]
- Updated dependencies [5d099f5]
- Updated dependencies [f9ab410]
  - @zhin.js/ai@1.1.45

## 1.0.9

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [250b026]
- Updated dependencies [bff8e31]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/ai@1.1.44

## 1.0.8

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [d9cc732]
  - @zhin.js/ai@1.1.43

## 1.0.7

### Patch Changes

- Updated dependencies [a383380]
  - @zhin.js/ai@1.1.42

## 1.0.6

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

## 1.0.5

### Patch Changes

- Updated dependencies [d033076]
  - @zhin.js/ai@1.1.41

## 1.0.4

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/ai@1.1.40

## 1.0.3

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/ai@1.1.39

## 1.0.2

### Patch Changes

- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [55811d1]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [acfaaef]
- Updated dependencies [57ea5f7]
- Updated dependencies [6e035e5]
- Updated dependencies [57ea5f7]
- Updated dependencies [55db42d]
- Updated dependencies [f48ba72]
- Updated dependencies [3237f63]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
  - @zhin.js/ai@1.1.38

## 1.0.1

### Patch Changes

- b36452a: Add an optional TypeSafe AI Jev structured-decision provider with typed Choice, Score and Noul results, bounded cancellation-aware requests, response validation, and generation-owned cleanup. Add explicit TypeSafe setup and local doctor checks; preserve chat configuration, store credentials as environment references, and begin recommendation in shadow mode.
- Updated dependencies [b36452a]
  - @zhin.js/ai@1.1.37
