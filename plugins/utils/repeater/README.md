# @zhin.js/plugin-repeater

复读机插件 —— 当群内连续多人发送相同消息时，Bot 自动跟读。

## 安装

```bash
pnpm exec zhin install @zhin.js/plugin-repeater
```

## 配置

在应用目录运行安装命令，会安装依赖并挂载到 主配置 `plugins` 映射，实例名为 `repeater`。在 `zhin.config.yml` 的实例节点修改配置：

```yaml
configVersion: 2
plugins:
  repeater: "@zhin.js/plugin-repeater"
repeater:
  threshold: 3 # 触发复读的最少人数（默认 3）
  cooldown: 30000 # 同一群冷却时间，毫秒（默认 30s）
  maxLength: 200 # 消息长度上限，超过不触发（默认 200）
```

配置声明位于 `src/config.ts`，由 `plugin.ts` 暴露给 Runtime 与 Console；默认值、类型、范围和表单说明由同一声明生成。配置不满足范围或含未知字段时，候选代不会激活；有效配置更新只重载插件。

### 按适配器 / 账号 / 群覆盖（ADR 0050 / 0055）

复读机支持全部四个层级（`global` / `adapter` / `endpoint` / `conversation`）：

- 适配器、账号层的覆盖写在 `repeater.overrides`；群（会话）层的覆盖由 Console「功能」区或群内自助命令写入项目数据库，原地生效，不重载插件。
- 会话层可以改 `threshold` 与 `cooldown`（`conversationFields`），也可以单独关闭某个群的复读。
- 开启 `features.selfService.enabled` 后，群里的 `admin`（默认含群主 / 管理员）可以用 `功能 设置 repeater threshold 5` 调整本群阈值（`selfServiceFields` 只含 `threshold`），用 `功能 关闭 repeater` 关闭本群复读。
- 推荐用会话层开关代替自建黑白名单。

Per-group overrides: the repeater supports all four levels. In a group, an `admin` can run `feature set repeater threshold 5` (only `threshold` is self-service) or `feature disable repeater` once `features.selfService.enabled` is on; the Console can also change `cooldown` per group.

## 工作原理

1. 监听群聊消息，记录每条消息的内容和发送者
2. 当 **不同** 用户连续发送完全相同的消息达到阈值时，Bot 自动回复该消息
3. 同一用户连续发送不计入（防止刷屏触发）
4. 每条消息在同一群只复读一次
5. 冷却期内不重复触发

## 命令

| 命令 | 说明 |
|------|------|
| `repeater-status` | 查看复读机运行状态 |

## 许可

MIT

## Language / 语言

命令说明和执行反馈跟随当前操作语言（简体中文或英文）；用户输入与第三方内容保持原样，不进行自动翻译。语言与时区、权限和实际执行行为独立。参见[官方插件语言说明](../../README.md#语言与内容)。

Command feedback follows the operation language. User input and third-party content remain unchanged. See the [localization guide](../../../docs/en/configuration/localization.md).
