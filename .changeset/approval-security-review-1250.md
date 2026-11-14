---
"@zhin.js/agent": minor
"@zhin.js/ai": patch
---

IM 审批安全修订（#1250 安全审查）：管理员本人确认只限策略明确标为管理员可批的操作——声明 `tags: ['admin_approvable']`（`ADMIN_APPROVABLE_TOOL_TAG`）的工具（Host 的 `schedule_add` 已声明）与写 `session` 记忆；敏感文件 / 受保护路径（如 `.git/config`）、Shell 命令、写 `global` / `platform` 记忆、未声明的插件工具审批与自动审核 Agent 的升级审批都需要主人，管理员的确认渠道直接返回「需要主人」而不弹提示（`ApprovalRequestInput.requiresOwner` / `adminMayApprove`）。管理员审批人要求端点层或以上的 `admin`（`holdsEndpointAdmin`；会话层 admin、被降级的会话层 owner 不算），且只在管理员自己的私聊里；群聊 / 频道未配置主人时不再退回管理员自批。读过外部内容、合流或旁听回合里写发起人自己的 `user` 记忆也先请发起人确认意图（防记忆投毒）。审批提示的「风险」行与危险工具硬闸提示同样打码，新增识别 `FOO_TOKEN=…` / `export API_KEY=…`、`Authorization: token …`、`X-Api-Key: …`、`--password=…` / `--token …`、URL 中的密码、JWT、AWS / Google 密钥；执行、指纹与授权范围仍用原参数。审批端口按用途报告可用性（`ApprovalPort.intentAvailable`、`isApprovalPortAvailable(port, purpose)`），只能确认意图的端口对硬闸与普通审批直接报不可用。「审批策略已变更」说明只认框架写入的拒绝记录（`ToolResultMessage.deniedUnderPolicy`），工具输出里伪造的策略戳不再触发。
