# @zhin.js/plugin-dungeon-expedition

多人、可恢复、确定性回放的 Zhin.js 地牢远征游戏。这个插件既是可玩的
1-4 人回合游戏，也是 `@zhin.js/game-kit` 的稳定性验收样本。

## 安装

```bash
pnpm add @zhin.js/plugin-dungeon-expedition
```

将插件加入 Zhin 配置后，可通过 `/地牢`、`地牢` 或 `/dungeon` 进入。

## 游戏流程

```text
创建队伍 -> 队员加入并准备 -> 三层探索
         -> 随机事件 / 普通战斗 / 守层者
         -> 胜利、失败或队长结束
```

常用指令：

```text
地牢 开始
地牢 加入
地牢 准备
地牢 出发
地牢 探索
地牢 攻击
地牢 防御
地牢 药水
地牢 状态
地牢 结束
```

支持原生按钮和数字文本 fallback。每个按钮携带 Session revision，点击旧
界面不会覆盖新回合，而会返回最新状态。

## 稳定性设计

- `VersionedSessionService` 串行化同一 Session 的本地并发操作。
- 持久化 `revision` 提供乐观并发检查。
- 持久化 `processed_actions` 抵御 Adapter 重复投递。
- `rng_state` 保存确定性随机状态，进程重启后可继续同一随机序列。
- `schema_version` 为后续存档迁移保留稳定边界。
- 所有规则在纯 `engine.ts` 中执行，不依赖 IM、数据库或系统时间。
- `defineGamePlugin` 统一数据库、超时、事件、战绩与 HMR 生命周期。

## 开发

```bash
pnpm --filter @zhin.js/plugin-dungeon-expedition build
pnpm --filter @zhin.js/plugin-dungeon-expedition test
```

核心文件：

- `src/engine.ts`：纯领域状态机。
- `src/session-service.ts`：版本化持久化和跨游戏冲突检查。
- `src/game-flow.ts`：消息身份、频道和旧 revision 处理。
- `src/view.ts`：结构化状态与操作键盘。
- `commands/`、`middlewares/`：约定式能力入口。
