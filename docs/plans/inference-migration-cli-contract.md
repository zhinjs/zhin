# 推理配置离线迁移入口

本文件补充已批准方案第 11 节的真实 CLI 接缝；不启动旧/新模型调用，不读取 `.env`，不加载用户插件入口。

## 命令与所有权

`zhin migrate inference --output <preview.json>` 只读取当前项目已选 Root YAML/JSON 原文，调用纯迁移 compiler 与已审内置 Driver 的纯 schema。预览列出源、资源/用途映射、凭据定位符、未决项和恢复步骤，不解密旧 vault，不读取环境变量。显式映射文件提供 Driver 的 exact owner/id/contract、模型能力与旧 Profile 映射；不足项继续 blocked，不猜协议/模型能力。第三方 Driver 不在自动导入范围：导入其声明模块也会执行顶层代码，不能假称无副作用；管理员需正常建立新 plan、重新录入凭据，再显式绑定旧 Session。原 catalog 和历史保留。

`--apply <preview.json>` 明确表示 Bot 已进入维护期，用户已备份配置、数据库和旧主密钥。命令只构造 Database Host、HostInference 仓储/凭据组件与静态 Driver snapshot，不启动 RootHost、Adapter、Schedule、IM、Workroom 或用户插件。连接数据库需要独立已知配置；不能为方便从 `.env` 读取密钥。配置仍是旧格式不阻断本入口。

所有 CLI 参数只能选择此进程本地管理员已拥有的项目；没有 HTTP 主体伪造路径。跨 Root/owner 未显式绑定则拒绝；个人目录单独导入原 owner，不扁平到 Host。

## 源一致性与提交

预览输出的 public fingerprint 只证明公开映射。源原文/私有 vault 密文版本的指纹放 Host 私有加密 proof；不得输出密钥 hash。Apply 重新读取固定源及私有版本，比对 proof 后才解密明确授权的定位符。旧 vault 使用原 owner+secretRef AAD 验证，再按目标账号 incarnation/revision/authContract 重封装。环境变量保留 env 引用，未读取值。图、receipt、加密 credential write 在同一现有 SQL 事务 CAS。

每次 apply 使用预先保存的同一 mutationId。丢失结果只查询该 receipt，不分配新 ID 重放；查询失败保留未知。已确认 receipt 的恢复不依赖当前 Driver/源是否仍可用。未提交的变更须重核 exact Driver/auth 合同与源版本。

## 文件切换与恢复

数据库导入和配置原子替换不能伪称单事务。迁移 journal 分别记录 source-checked、database-committed、startup-file-switched；未全部完成不得提示正常启动。原文件保留私有备份；仅显式 finalize 才按已核原文版本删旧模型 authority，保留其他配置/注释及角色权限。已退役的 `ai.agent.providerResilience.fallback` 会在预览及 journal 中列明，finalize 只删除该字段，保留其他重试和超时配置。失败从 receipt/journal 继续查询或恢复原文件，不能从头重复导入。

恢复需核对代码、原配置、主密钥与选定数据单元的 before/after journal。完整数据库备份只能在同一维护窗口、确认共享该数据库的其他 Root 没有后续写入时整体恢复；否则不得覆盖其他 Root 的新记录，应按已选单元核对恢复。此流程没有自动数据库回滚策略，也不能把外部登录/token 轮换当可撤销；本流程不执行这些外部操作。

旧 runtime-policy、个人 catalog 和 Session selection 的读取属于明确单元：保留旧记录，按真实 source revision 和完整 owner/session 地址映射；无映射者列 pending，不能偷偷改成 inherit/默认模型。旧 opaque 状态只标不可证明归属，不迁移供应商状态。

## 验证

使用临时合成工程、真实 SQLite、合成旧 vault 和静态 Driver。验证 preview 不读 `.env`/不解密/不启动插件；源改变和 wrong-owner0提交；图+密文同事务；acklost receipt 同 ID 回查；文件切换失败保留 journal/恢复；迁移后正常 CLI 认证管理入口可用、无模型调用。真实用户数据迁移和供应商验证未执行。

## 已存在 Profile 的旧 Session 手工绑定

第三方 Driver 不会由离线迁移器执行或探测。管理员先通过正常 Host 导入新 plan、录入凭据并保留旧目录/历史；旧 Session 的恢复使用独立、明确的选择，不根据别名猜模型：

```sh
zhin migrate inference --sessions-only --mapping session-bindings.json --output session-preview.json
zhin migrate inference --apply session-preview.json --maintenance --backup-confirmed
```

`session-bindings.json` 的每个 Session 项显式指定原 `identity.key`、持久化源 `sourceRevision`，以及完整的目标 `ProfileSelection`（`id/rootId/accountId/accountIncarnation/kind`）；需要恢复继承时也必须显式填写 `kind: inherit`。预览只选择这些原 Session 的元数据，并按静态个人身份绑定核对 owner。SQLite 通过只读图提前检查目标，标为 `targetValidation: verified-local`；其他数据库使用同一 Root-bound 旧元数据快照，只核对源与完整选择形状，标为 `deferred-until-apply`，不会在预览时连接远端或声称目标已验证。该验证状态属于公开预览指纹及 CLI 摘要。

Apply 在维护和备份确认后，从实际数据库当前图使用 canonical `resolveProviderProfile` 检查全部目标的 language kind、原 owner 可用性和 Account incarnation，任意一项无效都在首个 Session CAS 前拒绝。SQLite 的提前验证也不能替代此步。Profile 自身的生成参数与 native model 不在 Session 中复制，下一回合仍跟随该 Profile 的正常更新。

Apply 不加载目标 Driver/插件、不读取凭据，也不调用模型；复用现有 Session journal、源 revision CAS 与目标内容读回。丢失结果先核验实际目标内容，不自动重放；冲突不改成 inherit。此模式不切换启动文件，不删除旧 catalog、审批或历史。错误 owner、旧源 revision、错 Account incarnation 都必须在首个 Session 写入前拒绝。正常启动仍由管理员明确执行。
