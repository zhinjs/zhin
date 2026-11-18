---
"@zhin.js/kernel": minor
"@zhin.js/adapter": minor
"@zhin.js/core": minor
"@zhin.js/agent": minor
"zhin.js": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-milky": patch
---

协议端自己端口上的媒体地址不再因端口限制被拒（#1250 第 48 批端口限制的后续）。

- 端点的 `inboundMedia` 新增可选 `origins()`：声明 Endpoint 配置的协议端地址（`http(s)://` 或 `ws(s)://`，后者按同主机同端口的 `http(s)://` 处理）。`roots()` 改为可选，只声明 `origins()` 的端点同样有效。
- `fetchPublicMediaBytes()`（kernel）新增 `trustedOrigins`：与其中某个 origin 完全相同（scheme、主机、端口）的一跳不受默认端口限制；私网 / 回环、scheme 与 DNS 固定检查照旧，重定向到别的端口仍被拒。
- 入站识图与平台语音转写会带上产出端点声明的 origin；用户输入的地址（`[audio:URL]`、`voice_stt`）不受影响。
- Satori、Milky 声明 `baseUrl`；OneBot11、NapCat 的正向 WebSocket 声明 `url`，NapCat 的 HTTP 方式声明 `http_url`；反向连接没有配置地址，不声明。
