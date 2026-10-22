---
"@zhin.js/im-contract": patch
"@zhin.js/core": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-telegram": patch
---

Share segments accept `data.platform` (the song's music service: qq, netease, kugou, kuwo, migu). icqq maps it to the matching music app id when `config.appid` is absent and offers it to the Agent; adapters that cannot render share app metadata reject it like `audio` and `config`.
