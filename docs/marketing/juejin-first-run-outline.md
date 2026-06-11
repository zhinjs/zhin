# 掘金文章大纲：Zhin.js 首跑教程

> 配套 B 站分镜：[bilibili-first-run-storyboard.md](./bilibili-first-run-storyboard.md)  
> 建议与视频同日发布，文末互链。

---

## 标题（三选一）

1. **《10 分钟跑通 Zhin.js：TypeScript 写 IM 机器人，命令和 AI 可以混用》**（推荐）
2. 《不用真机也能调试 QQ 机器人逻辑：Zhin.js Sandbox + Remote Console 入门》
3. 《从 `npm create zhin-app` 到沙盒对话：一个现代 Node.js 聊天助手框架首跑》

**副标题（摘要第一句）**  
先在 **[demo.zhin.dev](https://demo.zhin.dev)** 零安装体验；再按本文用脚手架本地部署，Remote Console 沙盒验证 `hello` 与 `ai:`——Stable 黄金路径，不接 QQ 也能跑通。

---

## 发布元数据

| 字段 | 建议 |
|------|------|
| **标签** | `Node.js` `TypeScript` `开源` `教程` `机器人` |
| **分类** | 前端 / 后端均可（偏后端 & 工具） |
| **封面** | 终端 + Console 沙盒对话截图拼贴；大字「命令 + AI」 |
| **预计字数** | 2500～3500（含代码块） |
| **阅读时长** | 8～10 分钟 |

**文末 CTA（固定）**

- 文档：https://zhin.js.org  
- 仓库：https://github.com/zhinjs/zhin  
- Console：https://console.zhin.dev  
- 讨论：https://github.com/zhinjs/zhin/discussions  
- （若有）B 站视频链接

---

## 正文结构

### 开篇：为什么用 Zhin.js（约 200 字）

**要点**

- **引流 CTA**：文首放 [demo.zhin.dev](https://demo.zhin.dev)「30 秒在线试」
- Zhin.js 是 **TypeScript IM 聊天/生活助手框架**，不是 Cursor 类写代码 Agent。
- **命令 Bot** 与 **AI Agent** 走同一套消息链路，可混合使用。
- 支持 QQ、Telegram、Discord、飞书等（Platform Stable）；本文先跑 **Sandbox**，零平台风控。

**可配图**：消息流转简图（入站 → Dispatcher → Command / AI → 统一发送链）。

---

### 1. 环境要求（约 150 字）

**小节标题**：`1. 环境要求`

**正文要点**

- Node.js **20.19+** 或 **22.12+**
- pnpm 9+（脚手架可自动安装）
- Windows 用户见 [Windows 初始化指南](https://zhin.js.org/essentials/windows-setup.html)

**代码块：检查版本**

```bash
node -v   # 需 v20.19.0 或更高
pnpm -v   # 可选；未安装时 create 流程会引导安装
```

---

### 2. 创建项目（约 400 字）

**小节标题**：`2. 用脚手架创建第一个机器人`

**正文要点**

- 推荐 `npm create zhin-app`；`-y` 对齐 **Stable 默认**（Sandbox + Host + Ollama 配置 + `toolSearch: false`）。
- 去掉 `-y` 可交互选择数据库、IM 适配器、AI Provider。
- 生成后关注：`zhin.config.yml`、`.env`、`src/plugins/example.ts`。

**代码块：创建并进入项目**

```bash
npm create zhin-app my-first-bot -y
cd my-first-bot
```

**代码块：生成后的关键目录（说明用，不必全文粘贴）**

```text
my-first-bot/
├── src/plugins/example.ts   # 示例插件（含 hello 命令）
├── zhin.config.yml          # 主配置
├── .env                     # HTTP_TOKEN 等
└── package.json
```

**代码块：默认 hello 插件（摘录）**

```typescript
import { usePlugin, MessageCommand } from 'zhin.js';

const { addCommand } = usePlugin();

addCommand(
  new MessageCommand('hello')
    .desc('打招呼')
    .action(() => {
      return '你好！';
    }),
);
```

**提示框文案**

> `-y` 模式下 `bots: []` 是预期行为：Sandbox bot 在 Console 打开「沙盒」页时 **自动创建**，无需手写 `context: sandbox`。

---

### 3. 启动 Host（约 250 字）

**小节标题**：`3. 启动开发模式`

**正文要点**

- `pnpm dev` 启动 Host API，**没有内置网页 UI**。
- 调试界面在 **Remote Console**（https://console.zhin.dev）。
- API 地址以终端日志为准，常见 `http://127.0.0.1:8086`。

**代码块：启动**

```bash
pnpm dev
```

**代码块：日志里要找的信息（示例）**

```text
# 以你终端实际输出为准，常见类似：
# HTTP listening on http://127.0.0.1:8086
# 记下该地址作为 Console 的 API Base
```

---

### 4. 连接 Remote Console（约 350 字）

**小节标题**：`4. Remote Console 与沙盒`

**正文要点**

1. 打开 https://console.zhin.dev  
2. **API Base**：填上一步 Host 地址  
3. **Token**：填 `.env` 中 `HTTP_TOKEN`（`-y` 时为随机生成值）  
4. 侧栏进入 **沙盒**，连接成功后出现 `sandbox-xxxx` 类 bot  

**代码块：.env 示例**

```bash
# Web 控制台 / HTTP API（与 zhin.config 中 http.token 一致）
HTTP_TOKEN=your-token-here
```

**代码块：zhin.config.yml 中 http 段（概念）**

```yaml
http:
  token: ${HTTP_TOKEN:-minimal-dev-token}
  port: 8086
  # corsOrigins 默认已包含 https://console.zhin.dev
```

**排错要点**

- 连不上：Token、端口、本机防火墙  
- 不要用 URL 传 Token，在 Console 登录页填写  

---

### 5. 验证命令：hello（约 200 字）

**小节标题**：`5. 第一条消息：命令 Bot`

**正文要点**

- 在沙盒输入 `hello`，应收到 `你好！`  
- 此路径 **不调用 LLM**，验证 Command → 发送链  
- 与 AI 触发（`ai:`、`@机器人`）互不冲突  

**代码块：沙盒输入**

```text
hello
```

**预期回复**

```text
你好！
```

---

### 6. 热重载（约 300 字）

**小节标题**：`6. 改插件不用重启：热重载`

**正文要点**

- 修改 `src/plugins/example.ts` 后保存即可，**保持 `pnpm dev` 运行**  
- 再发 `hello` 应看到新文案  

**代码块：修改返回值**

```typescript
addCommand(
  new MessageCommand('hello')
    .desc('打招呼')
    .action(() => {
      return '你好！我是 Zhin 机器人～';
    }),
);
```

**代码块：再次验证**

```text
hello
```

---

### 7. 可选：AI 回合（约 350 字）

**小节标题**：`7. （可选）触发 AI：本地 Ollama`

**正文要点**

- Stable 默认配置 Ollama：`http://127.0.0.1:11434`  
- 需先 `ollama serve` 并 `pull` 与配置一致的模型（如 `qwen3:8b`）  
- 也可用 OpenAI 兼容 API，在 `zhin.config.yml` 配置 `ai.providers` + `.env` 放 Key  
- **没配模型时，前面 hello 已成功即说明框架可用**

**代码块：准备 Ollama**

```bash
ollama serve
ollama pull qwen3:8b   # 与 zhin.config 里 agents.zhin.model 一致
```

**代码块：沙盒触发 AI**

```text
ai: 用一句话介绍你自己
```

**代码块：zhin.config.yml AI 段（概念摘录）**

```yaml
ai:
  enabled: true
  providers:
    ollama:
      api: ollama-chat
      host: http://127.0.0.1:11434
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
  trigger:
    prefixes:
      - "ai:"
    respondToAt: true
```

---

### 8. 命令与 AI 如何共存（约 250 字）

**小节标题**：`8. 命令和 AI 不是二选一`

**正文要点**

| 场景 | 用法 |
|------|------|
| 固定逻辑 | `hello`、`签到` 等 `MessageCommand` |
| 智能对话 | `ai:` 前缀、群聊 `@机器人`、私聊直接聊 |
| 避免误触发 | `ai.trigger.ignorePrefixes` 可让 `/` 命令不走 AI |

**代码块：混合场景示例**

```text
hello              → 命令回复，不走模型
ai: 今天天气怎么样   → 走 ZhinAgent
/工具列表            → 内置运维命令（需 trusted 场景）
```

---

### 9. 下一步（约 300 字）

**小节标题**：`9. 接下来做什么`

**正文要点**

1. **接真机 IM**：`zhin setup` 或编辑 `zhin.config.yml` 加适配器（ICQQ、Telegram、Discord…）  
2. **写业务插件**：`zhin new my-plugin`  
3. **看能力分档**：Stable / Platform Stable / Advanced，避免把 test-bot 当默认模板  
4. **贡献与提问**：GitHub Discussions  

**代码块：已有项目加配置**

```bash
zhin setup    # 交互式加适配器、AI、数据库
zhin new sign-in   # 新建插件包
```

**警告框文案**

> `examples/test-bot` 是维护者 **厨房水槽** 配置，插件和 Advanced 能力很多，**不适合** 当作新手第一个项目。首跑请用 `npm create zhin-app -y` 或 `examples/minimal-bot`。

---

### 10. 常见问题 FAQ（约 300 字）

**小节标题**：`10. 常见问题`

| 问题 | 处理 |
|------|------|
| Console 连不上 | 核对 API Base、HTTP_TOKEN、端口占用 |
| `hello` 无回复 | 确认在 **沙盒** 页且已连接；看 `pnpm dev` 日志报错 |
| `ai:` 无回复 | Ollama 是否运行、模型是否已 pull、或配置 API Key |
| 想接 QQ | 文档 [适配器索引](https://zhin.js.org/adapters/) + 平台侧风控自行承担 |
| 和 Koishi/NoneBot 比？ | Zhin 偏 **TS 全栈 + AI 原生 + 热重载**；选型看团队栈与是否要内置 Agent 编排 |

---

### 结尾 CTA（约 100 字）

**固定段落模板**

```markdown
---

如果这篇帮你跑通了第一条消息，欢迎：

- ⭐ Star：https://github.com/zhinjs/zhin
- 📖 文档：https://zhin.js.org
- 💬 提问：https://github.com/zhinjs/zhin/discussions
- 🎬 视频版：（贴上 B 站链接）

下一篇计划：接 ICQQ / NapCat 真机调试，或写一个签到插件。
```

---

## 全文命令速查（可放文末或置顶评论）

```bash
# 1. 环境
node -v && pnpm -v

# 2. 创建
npm create zhin-app my-first-bot -y
cd my-first-bot

# 3. 启动
pnpm dev

# 4. Console：https://console.zhin.dev
#    API Base → 终端日志地址
#    Token    → .env 的 HTTP_TOKEN

# 5. 沙盒
#    hello
#    ai: 你好        # 需 Ollama 或 API Key

# 6. 可选 Ollama
ollama serve
ollama pull qwen3:8b
```

---

## 写作与排版 checklist

- [ ] 每个代码块前有一句「这段做什么」
- [ ] 截图：Console 登录页、沙盒 `hello` 成功、（可选）`ai:` 回复
- [ ] 强调 **Host 无内置 UI**，避免读者找 localhost 网页
- [ ] 强调 **test-bot ≠ 新手模板**
- [ ] Token 截图打码
- [ ] 文首加「预计操作时间 10 分钟」
- [ ] 发布后在 GitHub Discussions 发同标题帖并链回掘金

---

## 系列规划（掘金专栏）

| 篇序 | 标题方向 |
|------|----------|
| 01 | 本文：首跑 Sandbox |
| 02 | `zhin new` 写一个签到命令插件 |
| 03 | 接 ICQQ / NapCat：从沙盒到真机 |
| 04 | 能力分档解读：Stable 能承诺什么 |
| 05 | 命令 + cron + 记忆：生活助手最小闭环 |
