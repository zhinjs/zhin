# Chrome 堆内存分析指引（Zhin / test-bot）

本文档说明如何用 **Google Chrome DevTools** 分析 Node 进程「堆占用偏高」的原因。结论前置：**先看是否持续增长（泄漏），再看 Summary 里谁占字节最大（基线）。**

---

## 1. 你当前看到的现象（基线 vs 泄漏）

| 指标 | 含义 |
|------|------|
| `heapUsed / heapTotal` 接近 95% | V8 当前这一代堆**快用满**，会触发 GC 或**扩容**；不等于泄漏。 |
| `heapUsed` 长时间**几乎不变** | 多为**启动后常驻基线**（已加载的模块、工具、Provider、缓存）。 |
| `heapUsed` **持续单调上升** | 才优先考虑泄漏或无限增长的缓存/队列。 |

建议在**启动稳定后**和**运行一段时间（如 30 分钟）后**各打一份快照，用 Chrome 的 **Comparison** 对比。

---

## 2. 生成 `.heapsnapshot`（给 Chrome Memory 用）

### 方式 A：在已运行的机器人里发命令（推荐）

test-bot 的 `test-plugin` 已注册命令 **`heap`**：

1. 正常 `pnpm start`（或 `zhin start`）启动 test-bot。
2. 在私聊/可用渠道发送：`heap`。
3. 机器人会回复生成的文件路径，例如：  
   `<cwd>/heap-2026-04-29T12-00-00-000Z.heapsnapshot`  
   文件在项目**当前工作目录**（一般为 `examples/test-bot` 或你启动时的 cwd）。

底层为 Node 内置 `v8.writeHeapSnapshot()`，与 Chrome Memory 面板格式兼容。

### 方式 B：调试器附加后，在 Chrome 里点「Take heap snapshot」

1. 启动时带 inspect：  
   `NODE_OPTIONS='--inspect' pnpm start`  
   或：  
   `node --inspect node_modules/zhin/...`（按你实际入口）。
2. 本机 Chrome 打开：`chrome://inspect` → **Open dedicated DevTools for Node**。
3. 切到 **Memory** → 选 **Heap snapshot** → **Take snapshot** → 保存为 `.heapsnapshot`。

适合需要**在快照前手动 GC** 的场景（见下节）。

### 方式 C：快照前尽量「干净」一代堆（可选）

若 Node 以 `--expose-gc` 启动，可在打快照前执行一次全局 GC，减少「可回收但未回收」的噪声：

```bash
NODE_OPTIONS='--expose-gc --inspect' pnpm start
```

在 DevTools Console 执行：`gc()`，再打快照。**仅用于对比分析**，生产环境不要依赖 `gc()`。

---

## 3. 在 Chrome 里打开并阅读

1. 打开 **Google Chrome**（桌面版）。
2. 任意页面按 **F12** 或 **右键 → 检查**，打开 **DevTools**。
3. 切到 **Memory（内存）** 标签。
4. 左侧 **Profiles** 区域点击 **Load**，选择步骤 2 生成的 **`.heapsnapshot`** 文件。
5. 加载完成后，重点用下面几种视图。

### 3.1 Summary（汇总）

- 按 **Constructor** / **类型** 排序，看 **Shallow Size**、**Retained Size**。
- 常见大户：
  - **`(string)` / `(concatenated string)`**：大量模板、提示词、工具描述、源码字符串。
  - **`Object` / `Array`**：配置、工具列表、消息缓存等。
  - **`system / Context`**：与闭包、模块作用域相关。
  - **`compiled code`**：已编译的 JS 体积（适配器多、依赖多时明显）。

### 3.2 Containment / Retainers（保留链）

- 对可疑大类点进去，看 **Retainers**：是谁一直引用着它，避免误判「大数组」其实是被某单例挂住。

### 3.3 Comparison（对比两份快照）

- 先加载「运行 30 分钟前」快照，再 **Comparison** 选「30 分钟后」快照。
- 关注 **Delta** 里 **Retained Size** 持续变大的类型；若只有 `string` 略增而总堆稳定，多为正常业务文本。

---

## 4. 结合本仓库（test-bot）时建议重点搜什么

在 Summary 顶栏 **Filter** 里可尝试过滤（名称因版本略有差异）：

| 方向 | 说明 |
|------|------|
| **`zhin` / `@zhin`** | 框架与插件包加载后的对象与闭包。 |
| **`Tool` / `Skill` / `Agent`** | 工具/技能/Agent 相关描述与 schema 常驻内存。 |
| **`Model` / `Provider`** | AI Provider、模型列表、ModelRegistry 缓存。 |
| **`Session` / `Message` / `Chat`** | 若会话或历史未淘汰，可能偏大（需对比时间线）。 |
| **`Buffer` / `ArrayBuffer`** | 图片/文件/网络缓冲；与「外部内存」升高一起看。 |

你当前日志里典型配置（多适配器 + AI + 大量 workspace 工具/技能）下，**单进程 100MB+ 堆基线** 较常见；Chrome 里通常会看到大量 **string** 与 **compiled code**。

---

## 5. 可选：同时记录一份「文本内存条」便于和快照对应

在快照**同一时刻**在终端或日志里记下（或发 `mem` / `zt` 等你们已有的命令）：

```text
process.memoryUsage():
  rss / heapTotal / heapUsed / external / arrayBuffers
```

把该段文字和 `.heapsnapshot` 文件名放在同一目录，之后对照 Chrome 里看到的总体会更直观。

---

## 6. 何时需要改代码优化

- **Comparison** 显示某类对象 **Retained Size 随时间持续增大**（同一使用强度下）。
- **Retainers** 指向你们自写的 **全局 Map / 监听器 / 定时器** 未释放。
- **Detached DOM**（若在浏览器侧）— Node 侧一般无此项。

若堆高但 **长时间稳定**、RSS 不高，多为 **V8 堆上限尚未扩容** 导致的「heapUsed/heapTotal 比例高」，优先当作**基线**理解，再决定是否做懒加载适配器、减少 workspace 工具数量等架构层优化。

---

## 7. 文件清单速查

| 产物 | 用途 |
|------|------|
| `heap-*.heapsnapshot` | Chrome Memory → Load |
| 同次运行的 `memoryUsage` 文本 | 与快照时间对齐 |

生成快照后请勿把含敏感数据的 `.heapsnapshot` 提交到公开仓库（内含字符串与部分结构）。

---

## 8. 附录：你这份快照里「大户」代表什么（典型解读）

若在 **Summary** 里看到大量：

- 键名类似 **`{ chrome, chrome_android, edge, firefox, … }`**
- 对象带 **`__compat`**、**`version_added`**、**`mdn_url`**、**`support`**、**`tags`**
- **`(string)`** 数量级达到 **数十万**（例如 30 万+），Retained 与 **Object** 合计占堆一半以上

这通常**不是业务逻辑泄漏**，而是 **MDN 浏览器兼容性数据集** 被整包加载进 Node 进程：

- 本仓库依赖链里，**`farm-browserslist-generator`**（随 **`@farmfe/core`** / Farm 构建链）依赖 **`@mdn/browser-compat-data`**。
- **test-bot** 若启用 **`@zhin.js/console`**，会拉到 **`@zhin.js/console-app`**，其构建/开发管线使用 Farm，运行时相关模块会把这份 JSON 树解析成大量 **Object + string**，从而在快照里出现上述形状。

同时你会看到 **`ModuleLoader` / `LoadCache` / `ModuleWrap` / `ModuleJob`** 等占几 MB～十几 MB：这是 **Node 加载大量 ESM/CJS 模块** 的正常开销（多适配器、多插件、AI 栈、控制台栈一起进进程）。

### 结论（针对「堆为什么偏高」）

| 现象 | 含义 |
|------|------|
| **Strings ~40–50MB + 几十万 string** | 大 JSON（compat）+ 大量小键名/版本字符串，**预期内**。 |
| **`(compiled code)` ~30–40MB** | 已编译源码体积大（依赖多），**预期内**。 |
| **Retained 长期稳定** | 多为**基线**，不是持续增长型泄漏。 |

### 若希望「纯机器人」堆明显变小（可选）

- 在 **`zhin.config.yml`** 中**关闭不需要的插件**；若不需要 Web 控制台，可暂时**不加载 `@zhin.js/console`**，避免 Farm 相关依赖进入同一 Node 进程（具体以你当前配置为准）。
- 或减少 **同时启用的适配器** 数量，降低 **compiled code + 模块图** 体积。

以上与 **ZhinAgent / 会话内存** 无直接矛盾；要验证 AI 路径是否泄漏，仍应对比「空闲一段时间前后」两份快照的 **Delta**，而不是单看这一份基线快照。
