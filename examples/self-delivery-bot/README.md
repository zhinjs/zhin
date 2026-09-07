# Zhin GitHub self-delivery

受治理的 `zhinjs/zhin` Issue 入口，使用 Plugin Runtime，保持默认 minimal-bot 不变。

```sh
pnpm install
pnpm --filter self-delivery-bot dev
```

终端输入 `delivery doctor` 查看配置与真实连接状态。`delivery 123 明确的验收条件` 请求选入 Issue；输入来自终端并不自动证明 Sponsor 身份。没有 Host 安装身份端口时选入失败。

## 受信 Host 装配

标准 `installAgentHost` 的 `selfDelivery` 选项接收 `SelfDeliveryHostConfiguration`：

- `profile`：固定 `zhinjs/zhin`、GitHub 数字 repository ID、Catalog project ID、配置 revision、Sponsor principal IDs。
- `authenticate(input)`：把已验证的 IM/Console 会话映射为 principal，实时检查凭据；不得把用户名或 Issue 评论当认证。
- `readIssue`：可使用 `createSelfDeliveryGitHubIssueReader`；token 必须由独立只读服务身份提供，禁止使用维护者 ADMIN token。
- `planInput`：受信 Project/Profile 策略生成七阶段配置。proposalId 必须等于传入 operationId；metadata 必须匹配当前 Catalog/active Profile；执行角色、能力、预算、scheduler policy、Sponsor 和候选环境都必须固定。
- `codingExecutor`：安装 `DockerCodingAssignmentExecutor`，仅本项目的 `implement` Assignment 进入它；快照权威须实现当前 lease/fence 检查、持久 `claimExecution`，report store 须实现按 envelope digest 的持久 `find/save`。缺少此端口不会回退到普通本地模型。
- `deliveryProvider`：安装固定可信 workflow 的 `GitHubActionsDeliveryProvider`；标准 Host 注册到既有 Effect runtime，已存在其他 provider 时拒绝冲突。
- `readiness`：返回真实环境 blocker。结合 `inspectCodingDockerReadiness`、模型 runner 可用性、Actions provider `verifyConfiguration`、受信 workflow/tag、凭据权限和候选制品登记。Docker 可运行不等于模型执行器已装配。

Host 私有 composition 捕获已有 Kernel、Catalog、Profile registry 和 Run Profile pin writer；插件只能访问经过认证的 `select` 与只读 `doctor`，无法取得 Kernel writer。任务仍由标准 Workroom Scheduler 和既有 Executor/Effect runtime 推进。服务不提供另一个调度器。

必须使用持久卷保存 `.zhin`（Kernel/Profile/Effect 和 self-delivery Issue snapshots），父目录由 Host 预置。快照通过 fsync + create-only 原子发布；同一 Issue 对应确定性 operation，重启和重复请求重放原 Kernel admission。Issue 正文被固定，后续编辑不会改变在途需求；修改验收条件会拒绝，并要求走既有 governed plan revision。

## 当前边界

默认 CLI 项目可启动终端 doctor，但没有安装外部服务身份和私有 Host integration，故 readiness 为 false。不能仅添加 YAML 布尔字段绕过。实际自行托管者必须在可信 composition root 提供上述端口、Project/Profile、执行器和 Provider；缺任一连接不得标为可交付。

首版只支持经认证命令明确选入；没有自动消费 Issue/评论/webhook，未实现的 webhook 不能作为授权入口。现有 Kernel/Effect 事实保存 candidate/PR/CI/deployment 关联；本项目的快照仅保存 Issue → operation 的不可变入场信息，不复制运行状态。真实 GitHub 写入、人工合并、长期 canary 和生产准入仍按仓库计划逐项验收。
