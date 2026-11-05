---
sidebar: false
---

# ADR 0048 H0：待删模块引用盘点

> 基线：`origin/main` @ `4c99fb2a9`（2026-11-04）。方法：扫描仓库内所有 `.ts / .tsx` 的相对导入与 `@zhin.js/workroom*` 包导入，统计**删除集合之外**的引用方。各模块的删除阶段见 [ADR 0048 §8](../adr/0048-agent-harness.md#8-分阶段落地每阶段结束时主干可发布)。
>
> 重新生成：在仓库根目录运行本文末尾附录的脚本。实施每个阶段前重跑一次，按最新结果拆引用。

## 总览

| 删除对象 | 源码行数 | 删除集合外的引用文件（非测试） | 测试 / 评测引用 | 删除阶段 |
|---|---:|---:|---:|---|
| `packages/im/workroom/`（Kernel、runtime、portfolio、data-governance、remote、scheduler、room） | 66,434（另有测试 41,962） | 41 | 198 | H4 |
| `basic/cli/src/plugin-runtime/workroom/` | 5,636 | 属于上一行的引用方，随之删除 | — | H4 |
| `orchestration/five-agent` + `config/resolve-five-agent-binding.ts` | ~130 | 2 | 1 | H4 |
| `subagent/`、`spawn/`、`subagent-*.ts` | ~1,400 + 周边 | 14 | 9 | H2 |
| `deferred-worker-*`、`core/agent-loop-standalone.ts`、`detached-task/`、`task-executor.ts`、`standalone/` | ~1,500 | 11 | 19 | H2 |
| `assistant/job-*`（job engine / scheduler / worker / store） | ~1,500 | 6 | 8 | H3 |

## 1. Workroom（H4）

**宿主装配（`basic/cli`）**——全部随 Workroom 删除，Agent 宿主改为装配 `harness`：

- `basic/cli/src/plugin-runtime/workroom/*`（24 个 coordinator / projection / publication 文件）
- `basic/cli/src/plugin-runtime/agent/config.ts`、`agent/host-installer.ts`：去掉 Workroom 分支
- `basic/cli/src/plugin-runtime/console/`：`agent-console.ts`、`workroom-catalog-rpc.ts`、`workroom-run-control-route.ts`、`effect-sponsor-routes.ts`、`portfolio-sponsor-routes.ts`、`data-lifecycle-routes.ts`
- `basic/cli/src/plugin-runtime/protocol-host-installer.ts`：去掉 Workroom 协议注册
- `basic/cli/src/commands/agent-workroom.ts`、`basic/cli/src/utils/optional-workroom.ts`

**其他包**

- `packages/host/a2a/src/workroom-callback-runtime.ts` 等 2 个文件：A2A 改为 Mailbox 远程传输（H5），Workroom 回调删除
- `packages/console/protocol/src/index.ts`、`packages/console/client/client/workroom/*`：Workroom 页面与协议删除，H5 换成协作图页面
- 独立 Console 仓库 `console-ui/src`（`registerBuiltinShell.tsx`、`contracts/zhin-console.ts`、`ConsoleCommandCenter.tsx`、导航 i18n 等）：随协议一起删 Workroom 入口，需在该仓库另开 PR

**示例**

- `examples/multi-agent-room`：按 ADR 0048 重写为“多 Bot 成员的 visible Venue”
- `examples/self-delivery-bot`：依赖 Workroom self-delivery 子路径，删除或改写为普通插件 + 自我变更（ADR 0040）

**测试与脚本**

- `packages/im/workroom/tests`（172 个文件）随包删除；`basic/cli/tests/plugin-runtime/workroom`（21 个）一并删除
- `scripts/check-architecture-layers.mjs` 及其测试：去掉 Workroom 四目录约束，加入 `harness` 层级

**先迁移、后删除**（来自本地分支 `feat/workroom-group-collab`，尚未合入 main）：Venue Router、Peer Registry、`origin` 判定、入站去重与宽限期接管、出站 ledger。这些在 H4 搬进 `packages/im/core` 的 Venue 层；Room 的 Task 状态机、`room-task-*`、handoff 工具不迁移。

## 2. 五角色矩阵（H4）

- `packages/im/agent/src/config/index.ts`、`packages/im/agent/src/index.ts`：删除导出
- `ai.agents.<key>.nickname` 的“IM 协作展示”语义（`docs/configuration/generated.md`，ADR 0024）改为普通 Agent 人设字段
- 1 个测试文件随之删除

## 3. 子 Agent 与 spawn（H2）

引用方全部在 `packages/im/agent/src`，H2 用协作工具（`ask` / `delegate` → 临时 Actor）替换后删除：

| 引用方 | 处理 |
|---|---|
| `config/agent-interfaces.ts`、`config/zhin-agent-dependencies.ts`、`init/compose-zhin-agent-runtime.ts`、`internal/agent-host.ts`、`zhin-agent/index.ts` | 去掉 SubagentSystem 依赖，改为注入 harness |
| `tool/tool-system.ts` | 去掉 `spawn_task` 注册，注册协作工具 |
| `turn/auto-continue.ts`、`turn/subagent-auto-continue.ts`、`turn/persist-subagent-context.ts` | 子任务结果改为 `result` Mail 唤醒委派方，删除 |
| `media/deliver-subagent-result.ts` | 改由 Venue 投影，删除 |
| `index.ts` | 删除导出 |

评测：`subagent-approval-routed` 改写为 `harness-approval-routed-to-principal`（已在 H0 写好，见下文）。

## 4. 后台执行器（H2）

| 引用方 | 处理 |
|---|---|
| `turn/deferred-auto-continue.ts`、`turn/deferred-delivery.ts`、`turn/deferred-turn-state.ts`、`turn/persist-deferred-context.ts` | deferred 回合改为 `delegate`（backstage），删除 |
| `schedule-domain/execution-failure.ts`、`execution-result.ts`、`schedule-manager.ts` | 定时执行结果改为 Engagement 结局（H3 一并收口） |
| `service.ts`、`core/index.ts`、`zhin-agent/index.ts`、`index.ts` | 去掉 standalone loop 与 detached task 入口 |

## 5. 助手 job 引擎（H3）

- `assistant/event-ingress.ts`、`assistant/index.ts`、`assistant/profile-loader.ts`、`assistant/schedule-job-service.ts`、`plugin-runtime/index.ts`、`schedule-manager.ts`：定时改为 `timer` Mail；保留助手人设（profile）与投递，删除 job engine / scheduler / worker / store。

## 6. 配置字段（随对应阶段删除，出现即启动失败并提示迁移）

| 字段 | 阶段 |
|---|---|
| `ai.agent.subagentAutoContinue`、`subagentDirectImDelivery`、`subagentTools`、`subagentTurnMode`、`maxParallelSubagents` | H2 |
| Workroom Catalog、`ai.workrooms`（已拒绝）、sponsor / portfolio 相关 | H4 |
| 五角色绑定 | H4 |

## 附录：盘点脚本

```bash
python3 - <<'EOF'
import os,re,subprocess,collections
A='packages/im/agent/src'
targets={
 'workroom': ['packages/im/workroom/src'],
 'five-agent': [f'{A}/orchestration/five-agent', f'{A}/config/resolve-five-agent-binding.ts'],
 'subagent/spawn': [f'{A}/subagent', f'{A}/spawn'] + [f'{A}/{f}' for f in os.listdir(A) if f.startswith('subagent-')],
 'background': [f'{A}/deferred-worker-runner.ts', f'{A}/deferred-worker-tool-load.ts', f'{A}/core/agent-loop-standalone.ts', f'{A}/detached-task', f'{A}/task-executor.ts', f'{A}/standalone'],
 'assistant-jobs': [f'{A}/assistant/{f}' for f in os.listdir(f'{A}/assistant') if f.startswith('job-')],
}
files=[f for f in subprocess.check_output(['git','-c','core.quotePath=false','ls-files','-z','*.ts','*.tsx']).decode().split('\0') if f and not f.startswith('docs/')]
imp=re.compile(r"""(?:from|import|import\()\s*(?:'|")(.+?)(?:'|")""")
strip=lambda p: re.sub(r'\.(ts|tsx|js)$','',p)
inside=lambda p,roots: any(p==strip(r) or p.startswith(strip(r)+'/') for r in roots)
everything=[r for v in targets.values() for r in v]
for name,roots in targets.items():
    hits=collections.defaultdict(set)
    for f in files:
        if inside(strip(f),everything): continue
        for m in imp.finditer(open(f,encoding='utf-8').read()):
            spec=m.group(1)
            if spec.startswith('.') and inside(strip(os.path.normpath(os.path.join(os.path.dirname(f),spec))),roots): hits[f].add(spec)
            if name=='workroom' and spec.startswith('@zhin.js/workroom'): hits[f].add(spec)
    print(f'\n## {name}: {len(hits)} files')
    for f in sorted(hits): print(' ', f)
EOF
```
