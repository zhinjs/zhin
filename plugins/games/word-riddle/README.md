# @zhin.js/plugin-word-riddle

字谜 + 猜成语。每局随机 **10** 题，支持提示、跳过与连击计分。

## 词库来源

| 模式 | 来源 | 规模 |
|------|------|------|
| 字谜 | [riddle_demo](https://github.com/ytygxfmgzx/riddle_demo) CSV（构建为 `char-riddles.json`） | ~2.8 万 |
| 猜成语 | npm [`chinese-idiom-chengyu`](https://www.npmjs.com/package/chinese-idiom-chengyu)（MIT） | ~2.9 万 |

字谜数据在 `pnpm build` 时由 `scripts/build-char-riddles.mjs` 生成；本地可缓存 `data/riddles.csv` 避免重复下载。

## 命令

- `猜谜` / `猜谜 开始` — 字谜模式
- `猜谜 成语` — 猜成语模式
- `猜谜 继续` — 刷新界面

需启用 `database` 配置以持久化对局。
