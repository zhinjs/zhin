# 独立 Hugging Face 候选 Canary 包装

这里只准备新的 Docker Space bundle，不更新现有 `zhinjs/demo`，不上传 Hugging Face，不持有 HF/GitHub/模型凭据。控制面、Assignment claim、Kernel/Effect journal 和备份必须留在外部持久宿主。无持久卷的 Space 只承载可丢弃候选运行时。

## 输入与构建

从受信版本的 `self-delivery-candidate` workflow 取得同批 artifact。由可信下载方验证 GitHub archive digest、安全解压，并将 `manifest.json` 的 SHA-256、candidate SHA、run ID、run attempt 固定在配置中。manifest digest 不能从不受信下载内容自行生成后当作来源认证。

准备 JSON 配置：`artifactsDirectory`、尚不存在的 `outputDirectory`、`candidateSha`、`manifestDigest`（`sha256:...`）、`runId` / `runAttempt`（字符串）、`nodeImage`（Node 24 完整 digest）、`lockfilePath`。执行：

```sh
node deploy/huggingface-canary/build-bundle.mjs /absolute/path/canary-config.json
```

锁文件必须针对生成项目的 `file:artifacts/<file>.tgz` 依赖与全部 pnpm overrides 生成并经受信 smoke 校验；当前 P3 smoke 使用绝对临时目录，不能原样复用其锁文件。准备 bundle 后在无凭据隔离环境运行 `pnpm install --lockfile-only --ignore-scripts`，审查及固定依赖锁，再以最终锁文件重新生成 bundle。Docker 内强制 `--frozen-lockfile`，无匹配锁文件会失败。生成/验证锁文件和真实镜像构建尚未在本轮完成。

所有候选包来自同一 manifest 的 tgz；验证名称、版本、文件名、唯一性、文件类型和逐包 SHA-256，拒绝可变 Node tag。外部依赖按批准的锁文件安装，禁用 lifecycle scripts。Node / pnpm 工具链准备仍需要构建时网络。

## 健康与边界

`GET /health` 返回固定 candidate / manifest / build / lockfile 身份、包版本与摘要，以及最近一次实际 minimal-bot Terminal `/hello` 消息入口至输出的往返。每 30 秒重测，超过 90 秒无新结果则返回 503。Agent 只证明入口导入，不代表完整编排。Sandbox 尚未验证并明确返回 `not-tested`。

外部验收器必须核对身份、证据时效和持续观察窗口；单独 HTTP 200 不能授权发布。候选代码与健康服务器处于同一容器，因此健康响应不是独立可信审计证据。平台构建日志、镜像身份、固定外部探测和维护者批准仍需关联归档。

当前只有 bundle 生成与拒绝路径本地测试。未执行真实候选包安装、Docker 镜像构建、Space 创建/上传、长期健康观测、Sandbox 回环或回滚演练。启用前还需要新 Space 名称、平台部署身份、资源/睡眠策略和独立 Gate。
