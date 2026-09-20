# 安全检查清单

## Tool 执行边界

- [ ] 所有 builtin Tool 风险检查统一通过 `packages/im/agent/src/security/policy-facade.ts` 的 `runToolPolicies`；没有在单个 Tool 内复制或跳过策略链。
- [ ] Shell 规则检查 `security/exec-policy.ts` 与 `plugin-runtime/native-bash-tool.ts`，覆盖复合命令、引号、重定向、工作目录和环境变量。
- [ ] 文件规则检查 `security/file-policy.ts`、`file-role-policy.ts`、`turn-file-authority.ts` 与 native file tools，验证 canonical path、workspace 边界和角色权限。
- [ ] 网络规则检查 `network-policy.ts`、`turn-network-client.ts` 与 native web tools，验证 scheme/host/redirect/DNS 结果均不能扩大允许范围。
- [ ] `requiresApproval` 只接受 `never | on-risk | once | always`；即使为 `never` 也不能绕过权限、sandbox、网络、文件和 generation 策略。
- [ ] `approvalMode=auto` 的审核器 fail closed；`bypass` 只跳过确认，不提升 Tool 权限。

## Host、输入与凭据

- [ ] HTTP/Console/MCP/A2A 入口在进入业务逻辑前完成认证、授权、body size 与 schema 校验。
- [ ] Token 比较、来源与日志行为以当前 `packages/host/http/src/` 实现和测试为准，不把历史状态当作当前漏洞。
- [ ] SQL 使用参数化或受控查询构造器；Shell 不拼接未验证用户输入；HTML/SVG/Markdown 输出在对应协议边界转义或清洗。
- [ ] 路径解析后仍位于允许根目录；symlink、`..`、大小写和编码变体不能越界。
- [ ] 源码、日志、错误、fixture 和快照不包含 token、密码、cookie、私聊内容或完整外部响应。

## 依赖与验证

- [ ] 新依赖符合 `pnpm check:dependency-policy`，没有绕开 workspace overrides。
- [ ] `pnpm audit` 的结果按可达性和运行环境分析；锁文件命中本身不等于可利用漏洞。
- [ ] 对每个问题提供可复现输入或完整调用链，避免只凭 `rg` 命中定级。
