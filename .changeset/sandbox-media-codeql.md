---
"@zhin.js/adapter-sandbox": patch
---

Sandbox 媒体：内容嗅探对大写的 `<SCRIPT>` / `<SVG>` 同样识别为不可内联（此前已先转小写，现在正则本身也不区分大小写）；签名地址去掉 origin 结尾的 `/` 时不再用可回溯的正则。
