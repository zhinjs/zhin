# B 站视频分镜脚本：Zhin.js 首跑教程

> 配套掘金大纲：[juejin-first-run-outline.md](./juejin-first-run-outline.md)

## 片名（备选）

- 《10 分钟用 TypeScript 做出会聊天的机器人｜Zhin.js 首跑教程》
- 《不用真机 QQ，Sandbox Endpoint 里调试 ZhinAgent｜Zhin.js 入门》

**目标时长**：9～12 分钟  
**演示路径**：`npm create zhin-app` → `pnpm dev` → [console.zhin.dev](https://console.zhin.dev) → `hello` →（可选）`ai: 你好` → 热重载改插件  
**录制建议**：终端字号 18+、浏览器 125% 缩放；敏感 Token 打码；API Base **以终端日志为准**（create 默认 `8086`，minimal-bot 示例可能是 `8068`）

---

## 信息卡（发布用，可放简介）

| 项 | 内容 |
|----|------|
| 文档 | https://zhin.js.org |
| 在线 Demo | https://demo.zhin.dev |
| 仓库 | https://github.com/zhinjs/zhin |
| Console | https://console.zhin.dev |
| 创建命令 | `npm create zhin-app my-first-bot -y` |
| Node | 20.19+ 或 22.12+ |
| 包管理器 | pnpm 9+（脚手架会自动装） |

---

## 分镜表

### 镜头 0｜封面 + 钩子（0:00 – 0:40）

| 轨 | 内容 |
|----|------|
| **画面** | 快剪：**demo.zhin.dev** 沙盒 `hello` → 终端 `pnpm dev` → Console 对话 →（若有）`ai:` 有回复。 |
| **旁白** | 「想做一个 QQ / Telegram 机器人，但不想折腾风控、也不想 Python 栈？今天用 **Zhin.js**——一个 **TypeScript 写的 IM 聊天助手框架**——从零跑到能对话。全程大约十分钟，跟着做就能复现。」 |
| **字幕** | 大字：**TypeScript AI Agent · Endpoint · 命令 + AI · 热重载** |
| **备注** | 前 3 秒必须有「结果画面」，别先讲 PPT。 |

---

### 镜头 1｜Zhin 是什么 / 不是什么（0:40 – 1:35）

| 轨 | 内容 |
|----|------|
| **画面** | 简单三栏字卡（或 README 截图圈重点）：左「命令 Bot」、中「AI 助手」、右「QQ/TG/Discord…」。再划掉一行：「≠ Cursor 写代码 Agent」。 |
| **旁白** | 「Zhin 定位是 **聊天和生活助手**：签到、定时提醒、私聊群聊 AI，都能做。命令和 AI **可以混用**——日常走 `hello` 这种命令，需要智能再 `@机器人` 或 `ai:` 前缀。**它不是** 在终端里帮你改整个仓库的 coding agent。」 |
| **字幕** | **命令 + AI 同一套栈 · 插件化 · 热重载** |
| **备注** | 这 50 秒是在筛观众，讲清楚能减少后续「怎么不能帮我写项目」的差评。 |

---

### 镜头 2｜环境准备（1:35 – 2:15）

| 轨 | 内容 |
|----|------|
| **画面** | 终端执行：`node -v`、`pnpm -v` |
| **旁白** | 「只需要较新的 Node.js。pnpm 没有的话，等会儿创建项目时脚手架会帮你装。」 |
| **字幕** | 贴一行：`文档 zhin.js.org` |
| **备注** | Windows 用户可在简介链 [Windows 初始化指南](https://zhin.js.org/essentials/windows-setup.html)。 |

---

### 镜头 3｜一键创建项目（2:15 – 4:30）

| 轨 | 内容 |
|----|------|
| **画面** | 干净桌面，新建文件夹，终端：`npm create zhin-app my-first-bot -y`，`cd my-first-bot` |
| **旁白** | 「用官方脚手架创建项目。视频里加 `-y` 走 **Stable 默认**：Sandbox 调试、Ollama AI 配置、最少插件——和文档里的黄金路径一致。你自己玩可以去掉 `-y`，向导里选数据库、QQ、Telegram 都行。」 |
| **画面** | 快速扫一眼生成结构：`zhin.config.yml`、`.env`、`src/plugins/example.ts`；`pnpm install` 可 2x 快进。 |
| **旁白** | 「装完后，重点看三个文件：配置文件、环境变量里的 `HTTP_TOKEN`、以及示例插件。」 |
| **操作** | 打开 `.env` 指 `HTTP_TOKEN=`；打开 `src/plugins/example.ts` 指 `hello` 命令。 |
| **字幕** | `-y` = Stable 默认 · 沙盒先跑通再接真机 IM |

---

### 镜头 4｜启动开发模式（4:30 – 5:30）

| 轨 | 内容 |
|----|------|
| **画面** | 终端：`pnpm dev` |
| **旁白** | 「`pnpm dev` 会开 **Host API**，注意日志里的监听地址——一般是 `http://127.0.0.1:8086`，以你终端为准。这里没有内置网页 UI，调试界面在 **Remote Console**。」 |
| **画面** | 用鼠标圈出日志中的 **API Base / 端口**。 |
| **字幕** | **Host 只有 API · UI 在 console.zhin.dev** |

---

### 镜头 5｜连接 Remote Console（5:30 – 7:00）

| 轨 | 内容 |
|----|------|
| **画面** | 浏览器打开 https://console.zhin.dev |
| **旁白** | 「打开官方 Remote Console。第一次要填两个东西：**API Base** 填刚才终端里的 Host 地址；**Token** 填 `.env` 里的 `HTTP_TOKEN`。」 |
| **操作** | 登录页填写 → 主界面 → 左侧 **「沙盒」**。 |
| **旁白** | 「进沙盒页时，框架会 **自动创建 Sandbox bot**——配置里 `endpoints: []` 是正常的。」 |
| **字幕** | API Base = 终端地址 · Token = .env 的 HTTP_TOKEN |

---

### 镜头 6｜第一条命令：hello（7:00 – 7:50）

| 轨 | 内容 |
|----|------|
| **画面** | 沙盒发送：`hello` |
| **旁白** | 「先发一条普通命令，不走 AI。这是 Stable 路径的冒烟测试。」 |
| **画面** | 收到回复 **`你好！`** |
| **字幕** | `hello` = 命令 Endpoint · 不消耗模型 |

---

### 镜头 7｜高光：热重载（7:50 – 8:50）

| 轨 | 内容 |
|----|------|
| **画面** | 改 `src/plugins/example.ts` 的 `hello` 返回值，保存，**不重启** `pnpm dev` |
| **旁白** | 「改插件保存就行，**不用重启进程**。」 |
| **画面** | 沙盒再发 `hello`，展示新文案。 |
| **字幕** | **热重载 · 改完即生效** |

---

### 镜头 8｜可选：AI 回合（8:50 – 9:50）

| 轨 | 内容 |
|----|------|
| **画面** | `ollama serve`、`ollama pull qwen3:8b`（与配置一致） |
| **旁白** | 「AI 是可选的。默认配了本地 **Ollama**；没装可以跳过。有 API Key 可换 OpenAI 兼容接口。」 |
| **画面** | 沙盒发送：`ai: 用一句话介绍你自己` |
| **字幕** | 需自配 Ollama 或 API Key |

---

### 镜头 9｜下一步 + 收尾 CTA（9:50 – 10:30）

| 轨 | 内容 |
|----|------|
| **画面** | 结尾字卡：`zhin setup` / `zhin new` / 能力分档 / GitHub Star |
| **旁白** | 「今天跑通的是 **Stable 沙盒路径**。接真机用 `zhin setup`；别 clone test-bot 当新手模板。链接在简介。」 |
| **字幕** | **npm create zhin-app · zhin.js.org · github.com/zhinjs/zhin** |

---

## 置顶评论模板

```text
【在线 Demo】https://demo.zhin.dev

【环境】Node 20.19+ / 22.12+ · pnpm 9+（脚手架可自动安装）

【命令】
npm create zhin-app my-first-bot -y
cd my-first-bot
pnpm dev

【Console】https://console.zhin.dev
· API Base：看 pnpm dev 终端里的地址（常见 http://127.0.0.1:8086）
· Token：项目 .env 的 HTTP_TOKEN

【沙盒】侧栏「沙盒」→ 发 hello → 再试 ai: 你好（需 Ollama 或 API Key）

【文档】https://zhin.js.org
【仓库】https://github.com/zhinjs/zhin
【讨论】https://github.com/zhinjs/zhin/discussions

常见问题：
1）连不上 Console → Token/端口是否一致
2）AI 无回复 → 是否 ollama serve + 模型已 pull
3）想接 QQ → 文档「适配器」+ zhin setup
```

---

## B 站元数据建议

| 字段 | 建议 |
|------|------|
| **分区** | 科技 → 软件应用 |
| **标签** | `nodejs` `typescript` `开源` `教程` `机器人` `QQ机器人` `AI助手` |
| **简介第一句** | 10 分钟从零跑通 Zhin.js：脚手架创建 → Remote Console 沙盒 → 命令与 AI |
| **系列规划** | 第 2 集：接 ICQQ/NapCat；第 3 集：写一个签到插件 |

---

## 录制检查清单

- [ ] 全新目录演示，避免本机脏状态
- [ ] `.env` 的 Token 录屏时后半打码
- [ ] `pnpm dev` 日志里 API 地址清晰可见
- [ ] `hello` 成功画面至少停留 2 秒
- [ ] 热重载一镜 **不重启** 终端
- [ ] AI 段落标注「可选」，失败有兜底剪辑方案
- [ ] 结尾口播 **test-bot ≠ 新手模板**
