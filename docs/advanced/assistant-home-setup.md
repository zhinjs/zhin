---
sidebar: false
---

# Home Assistant × Zhin 接入清单（M4）

从零到「私聊 bot：关掉客厅灯」的逐步验收清单。使用 **HA REST + 别名**，**不需要**配置 MCP。

完整能力说明见 [Assistant Home Domain](./assistant-home)。

---

## 前置条件

- [ ] Home Assistant 已运行，浏览器能打开 Web 界面（如 `http://192.168.x.x:8123`）
- [ ] Zhin test-bot（或你的 bot）已启用 `assistant.enabled: true`
- [ ] 你是 ICQQ（或其它平台）bot 的 **master**（`zhin.config.yml` → `endpoints[].master`）
- [ ] 已执行 `pnpm --filter @zhin.js/agent build`（改过 agent 包后）

---

## 第 1 步：在 HA 里找到 entity_id

1. 打开 HA → **设置** → **设备与服务** → **实体**（或开发者工具 → **状态**）
2. 找到要控制的灯，记下 **实体 ID**，格式为 `light.xxx`、`switch.xxx` 等  
   示例：`light.living_room`（客厅灯）

验证（浏览器或终端）：

```bash
curl -sS -H "Authorization: Bearer 你的令牌" \
  http://192.168.1.10:8123/api/states/light.living_room
```

应返回 JSON，含 `"state": "on"` 或 `"off"`。

- [ ] 已确认 entity_id
- [ ] curl 返回 200（令牌正确时）

---

## 第 2 步：创建 HA 长期访问令牌

1. HA 左下角 **个人资料**（头像）
2. 底部 **安全** → **长期访问令牌**
3. **创建令牌**，命名如 `zhin-bot`
4. **复制令牌**（只显示一次），存入本地密码管理器

写入 bot 项目 `.env`（不要提交 git）：

```bash
HA_URL=http://192.168.1.10:8123
HA_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

注意：

- URL **不要**末尾斜杠（代码会自动拼 `/api/...`）
- 若 Zhin 与 HA **不在同一台机器**，用局域网 IP，不要用仅本机可解析的 `homeassistant.local`（除非已配 mDNS）

- [ ] 令牌已写入 `.env`
- [ ] 第 1 步 curl 用新令牌成功

---

## 第 3 步：配置 Zhin 别名

编辑 `zhin.config.yml`（test-bot 示例）：

```yaml
assistant:
  enabled: true
  home:
    enabled: true
    restUrl: ${HA_URL}
    restToken: ${HA_TOKEN}
    aliases:
      客厅灯: light.living_room    # 左侧=对话用中文名，右侧=HA entity_id
    policy:
      requireMaster: true
      confirmServices: [lock, alarm_control_panel]
```

可选：为子 Agent 单独绑定（主 Agent 也可直接调 `home_*`）：

```yaml
ai:
  agents:
    home:
      provider: openai-main
      model: mimo-v2.5-pro
```

子 Agent 人设见项目内 `agents/home.agent.md`。

- [ ] `assistant.home` 已取消注释并保存
- [ ] `aliases` 中至少有一条与真实 entity 对应

---

## 第 4 步：构建并启动

```bash
cd examples/test-bot   # 或你的 bot 目录
pnpm --filter @zhin.js/agent build
pnpm start             # 或 zhin start
```

启动日志中应出现类似：

```text
assistant_runtime: true; ...; events: true
assistant_home: true; aliases: 1
```

若没有 `assistant_home`：

| 现象 | 处理 |
|------|------|
| 无 `assistant_home` | 检查 `home.enabled`、`HA_URL`、`HA_TOKEN` 是否都有值 |
| `aliases: 0` | 检查 `aliases` 块 YAML 缩进 |
| 启动报错找不到 agent | 先 `pnpm --filter @zhin.js/agent build` |

- [ ] 日志含 `assistant_home: true`
- [ ] `aliases` 数量正确

---

## 第 5 步：REST 冒烟（不经过 AI）

用与 `.env` 相同的变量：

```bash
# 读状态
curl -sS -H "Authorization: Bearer $HA_TOKEN" \
  "$HA_URL/api/states/light.living_room" | head -c 200

# 开灯（确认无人睡觉时再测）
curl -sS -X POST -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id":"light.living_room"}' \
  "$HA_URL/api/services/light/turn_on"
```

- [ ] REST 读写正常

---

## 第 6 步：私聊 bot 第一次控灯

使用 **master 账号** 私聊 bot（非 master 会被 `requireMaster` 拒绝）：

1. **列别名**  
   > 列出智能家居设备别名  

   预期：Agent 调用 `home_list_aliases`，返回「客厅灯」等。

2. **查状态**  
   > 客厅灯现在什么状态？  

   预期：`home_get_state(alias="客厅灯")`，回复 on/off。

3. **关灯**  
   > 关掉客厅灯  

   预期：`home_turn_off(alias="客厅灯")`，HA 灯灭，bot 简短确认。

4. **开灯**  
   > 打开客厅灯  

   预期：`home_turn_on(alias="客厅灯")`。

- [ ] 列别名成功
- [ ] 查状态成功
- [ ] 关灯成功
- [ ] 非 master 账号被拒绝（可选交叉验证）

---

## 第 7 步：锁类设备审批（可选）

若别名指向 `lock.xxx`，开/关锁应返回 `ZHIN_NEEDS_OWNER`，需 master 在私聊确认后再执行。

- [ ] lock 写操作触发审批提示

---

## 第 8 步：与 Event Ingress 联动（可选）

HA 自动化触发 Zhin Agent（不需 MCP）：

1. 确认 `assistant.events.enabled: true`
2. 在 HA 配置 `rest_command` 指向 `POST http://bot地址:8086/api/assistant/events`
3. 详见 [Assistant Event Ingress](./assistant-events)

- [ ] （可选）HA automation → Zhin 事件 → 私聊通知

---

## MCP 说明（本清单不需要）

| 方式 | M4 是否必需 |
|------|-------------|
| `assistant.home` + REST + `home_*` | **是**（推荐） |
| `ai.mcpServers` + HA MCP Server | **否**（进阶，工具名 `mcp_homeassistant_*`） |

`assistant_home: true` 日志 **不是付费功能**，仅表示 Home 模块已加载。

---

## 排障速查

| 现象 | 可能原因 |
|------|----------|
| `HA API 401` | 令牌错误或过期，重新创建 |
| `HA API 404` | entity_id 写错或实体未启用 |
| `未知设备别名` | `aliases` 键名与对话不一致（区分中英文） |
| `连接 refused` | `HA_URL` 错、防火墙、或 Zhin 访问不到 HA 网段 |
| Agent 不调 `home_*` | 未 build agent、或 `assistant_home` 未出现在日志 |
| 工具被拒绝 | 非 master 私聊；换 master 账号 |

---

## 相关文档

- [Assistant Home Domain](./assistant-home) — 配置字段与权限
- [Assistant Event Ingress](./assistant-events) — HA `rest_command`
- [MCP 集成](./mcp) — 可选 MCP Client（与 M4 REST 路径独立）
