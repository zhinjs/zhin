# qq-games-bot

面向 **QQ 公域群** 的游戏机器人示例：游戏大厅 + 8 款游戏 + 签到统计，**默认关闭 AI**。

`package.json#zhin.plugins` 声明 QQ Adapter、Group Suite、Game Hub 与全部游戏子插件；
`zhin.config.yml` 只按 `plugins.<instanceKey>` 提供各自配置。运行入口统一为
`zhin runtime start`，不依赖 legacy host-router/host-api。

## 快速开始

```bash
# 仓库根目录
pnpm install
pnpm --filter @zhin.js/game-kit build
pnpm --filter @zhin.js/adapter-qq build

cd examples/qq-games-bot
# 从 test-bot 复制 QQ 凭据（endpoint 名称同为 zhin）
cp ../test-bot/.env .env   # 或只复制 HTTP_TOKEN / QQ_APPID / QQ_SECRET

pnpm install
pnpm dev
```

## 命令

| 命令 | 说明 |
|------|------|
| `/游戏` | 游戏大厅（同群均可点按钮） |
| `/帮助` | 全部玩法与 QQ 群 @ 说明 |
| `/战绩` | 本群个人战绩 |
| `/排行 [游戏]` | 本群排行榜 |
| `签到` / `stats` | 群工具（group-suite） |

## 实机回归

见 [QQ-REGRESSION.md](./QQ-REGRESSION.md)。

## 正式上线

见 [LAUNCH.md](./LAUNCH.md)。

## 本地 7×24 守护

```bash
pnpm start
# 或
pm2 start ecosystem.config.cjs
```
