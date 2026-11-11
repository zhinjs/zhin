---
"@zhin.js/kernel": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/logger": patch
"@zhin.js/host-http": patch
"@zhin.js/a2a": patch
"@zhin.js/mcp": patch
"@zhin.js/pagemanager": patch
"@zhin.js/client": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-link-poster": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-music": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-short-url": patch
"@zhin.js/feature-kit": patch
"@zhin.js/middleware": patch
---

fix: 全仓审计修复

- kernel: 模板求值沙箱不再泄漏宿主对象——宿主函数的返回值与抛出的错误会重新包裹代理（`segments.map(x=>x).constructor.constructor(...)` 之前可拿到宿主 `Function`），并禁止通过代理写入/删除宿主属性。
- agent: exec 白名单正则按整体锚定（`git|npm` 不再匹配 `gitevil`）；SSRF 主机名黑名单识别尾点形式（`localhost.`）；Docker 沙箱 `always` 模式的 fail-closed 分支可被触达；声明缺失的 `chalk` 依赖。
- ai: 摘要按最新优先加载（超过 500 条时不再使用过期锚点）；修复 `test` 脚本指向不存在的配置。
- cli: `ZHIN_LOG_LEVEL` 生效（修复运算符优先级）；移除旧守护进程遗留的无引用进程辅助函数。
- logger: `formatCompact` 不再把 `config: 'yaml'`、`direction: 'in'` 这类非路径值改写成 `./yaml`。
- host-http: 未配置数据库时 `db:tables` 与有数据库时一致返回 `{ tables }`。
- a2a: 405 响应把 `Allow` 放进响应头。
- pagemanager: 内联进 `<script>` 的页面元数据转义 `<`。
- client: 事件历史请求失败时携带 HTTP 状态，token 失效可触发重新登录。
- scaffold-wizard / create-zhin-app: 修正适配器文档 URL 与模板里的 `@zhin.js/tool` 导入。
- adapter-wechat-mp: 签名比较改为常量时间。
- adapter-kook: 声明运行时依赖 `ws`。
- plugin-lottery: 遗漏值按最近一次出现计算；推送目标 schema 字段与实现一致（`endpointKey`）。
- plugin-code-runner: 语言校验改用自有属性判断。
- plugin-link-poster: 抓取前校验主机名白名单（修复 SSRF），超时覆盖响应体读取。
- 其余包：从 `files` 中移除不存在的目录。
- feature-kit / middleware: 修正 README 中层级错误的文档链接。
