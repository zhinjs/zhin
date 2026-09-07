# 自闭环服务身份与发布基线

部署目标分开登记：现有公开演示 Space `zhinjs/demo` 保留；长期候选使用独立 Space；控制面不在候选进程内运行。2026-09-07 只读核验现有 Space 为 Docker / cpu-basic / RUNNING，无挂载卷。其可重建磁盘不承载 Kernel、Effect、dispatch claim 或审批事实。

## GitHub App 配置

`github-apps/` 中四份 manifest 分别定义入场读取、受控 Git 上传、独立证据读取、Actions dispatch 身份。只安装到 `zhinjs/zhin`，不要选择所有仓库。配置文件不含密钥，也不代表 App 已经创建或安装。

| 身份 | 用途 | 运行边界 |
| --- | --- | --- |
| intake | 读取 Issue 和仓库身份 | 不能写 Issue、PR 或 Git |
| workspace | Git objects / 自动化分支 / 草稿 PR；只读保护检查 | 只在受信 gateway；不得交给 Docker 或模型 |
| reviewer | 读取源码、checks、Actions 和 PR | 不替代维护者 GitHub approve；无任何写权限 |
| actions | 受信固定 workflow dispatch / artifact 查询 | 只在发布 provider；不能写 Git 或环境配置 |

所有身份均无 administration write、workflows write、secrets、environments、deployments、packages 或组织管理权限。不加入 main bypass。App 的 contents write 本身不是路径权限；必须继续经过 Git Workspace Lease、实际 diff 和 fence 校验。Actions write 本身也不限于一个 workflow，必须由固定版本 provider 约束。

根据 [GitHub 官方 manifest 流程](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) 注册后，将 App ID、installation ID、账号和 repository ID 登记到 Host 私有配置；私钥放宿主密钥管理，运行时签发短期 installation token。验证真实 installation 的权限和仓库集合后才能将 doctor 标为 ready。禁止把维护者 `gh` 管理员会话当作默认服务凭据。当前服务用经认证命令选入 Issue，因此 webhook 保持关闭；启用前须实现验签与重放防护。

## 正式发布 Gate

2026-09-07 已通过远端 API 建立并独立回读：

- `main` 保留 6 项 Actions 必需检查、独立 PR Review、strict checks、管理员强制保护及禁止强推/删除。
- `npm-production` 环境：required reviewer `lc-cn`，禁止管理员 bypass，仅受保护分支。
- `github-pages` 环境：required reviewer `lc-cn`，禁止管理员 bypass，保留已有自定义 branch policy。
- 两个环境允许发起者本人执行人工部署批准，因为目前登记的人工发布负责人只有 `lc-cn`；这不豁免 main PR 独立 Review，也不授权 agent 代按批准。

本分支将 publish job 绑定 `npm-production`，npm 与 Pages 均仅允许本仓库 main。**npm 的 workflow Gate 要在该 YAML 经审阅合入 main 后才生效**；仅创建环境不会拦住尚未引用它的旧 job。既有 Pages deploy 已引用环境，因此远端 reviewer 规则已对后续部署生效。Pages 的写权限只授予 deploy job。候选 CI 和 Pages 的依赖安装使用独立 `secrets.NPM_TOKEN`，只在禁用 scripts / pnpm hooks 的安装步骤注入，后续 lifecycle / build / test 不携带此 token。这个 Secret 必须存放可读取 `@icqqjs/icqq` 和 `@icqqjs/qqsign` 的 GitHub Token（`read:packages` 且所属账号有包访问权），其命名不代表 npmjs 凭据。不复用正式 `PERSONAL_TOKEN`，没有自动回退。正式 publish 仍保留现有发布凭据，但仅在人工 Gate 后获得。

候选 workflow 不使用这两个正式环境。受信 workflow 必须先经人工审核纳入 main，创建受保护且固定 SHA 的 tag，再把实际 workflow ID / tag / SHA / actor IDs 登记到 provider；当前分支本身不是获批控制面版本。


## 真实 CI 首轮结果

PR #657（`aec523c47`）的首次 Actions 验证在依赖安装被阻塞：`@icqqjs/icqq@1.12.3` 返回 `ERR_PNPM_FETCH_403`。GitHub API确认 `@icqqjs/icqq` 和 `@icqqjs/qqsign` 均为私有包。包的 Manage Actions access 中搜索 `zhinjs/zhin` / `zhin` 无可添加结果，当前临时 job-token 无法读取这两个跨组织依赖。未改变私有包可见性或访问者，也未回退正式 PAT。

这是待解决的外部身份/包分发阻塞，不能把本地缓存安装成功视为CI可用。维护者随后选择配置独立 `NPM_TOKEN`，workflow已接入上述安装边界；Secret配置完成后重跑验证。不能为了绿色状态跳过 ICQQ 包或删除现有全仓质量检查。相关运行：[CI](https://github.com/zhinjs/zhin/actions/runs/34104413211)、[安装预算](https://github.com/zhinjs/zhin/actions/runs/34104413241)。
