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
- `fetchPublicMediaBytes()`（kernel）新增 `trustedOrigins`：URL 本身就在其中某个 origin 上（scheme、主机、端口完全相同）时，这个 origin 内的各跳不受默认端口限制；从别处重定向进来、或重定向到别的端口，仍只认默认端口。私网 / 回环、scheme 与 DNS 固定检查照旧。
- 适用范围：协议端部署在**公网**主机的非默认端口上。协议端与实例同机或在内网时，地址因私网规则被拒，与本次无关；识图下载仍只走 https，平台语音链接允许 http。
- 入站识图与平台语音转写会带上产出端点声明的 origin；用户输入的地址（`[audio:URL]`、`voice_stt`）不受影响。
- Satori、Milky 声明 `baseUrl`；OneBot11、NapCat 的正向 WebSocket 声明 `url`，NapCat 的 HTTP 方式声明 `http_url`；反向连接没有配置地址，不声明。
