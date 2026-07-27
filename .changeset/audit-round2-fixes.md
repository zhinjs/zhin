---
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/client": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/schema": patch
"@zhin.js/database": patch
"@zhin.js/schedule": patch
"@zhin.js/game-kit": patch
"@zhin.js/html-renderer": patch
"@zhin.js/satori": patch
"@zhin.js/speech": patch
"zhin.js": patch
"@zhin.js/plugin-short-url": patch
"@zhin.js/process-monitor": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-music": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-word-riddle": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-guess-number": patch
---

第二轮全量审计修复批（8 面 ~60 bug）：

- **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
- **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
- **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
- **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
- **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
- **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。
