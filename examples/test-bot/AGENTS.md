# Agent Memory

## 仓库定位

- 维护者 **Plugin Runtime 厨房水槽**（全 adapters + utils + games），非用户模板
- Stable：`../minimal-bot`；L4：`../full-bot`；根 `pnpm dev:test` → 本目录

## 运行验证

```bash
pnpm dev:test
```

- Console `https://console.zhin.dev` · API `http://127.0.0.1:8086`
- Sandbox `/sandbox`；命令 `/ping` `/mem` `/games` `/猜数`
- 无平台凭据时适配器 soft-fail offline，不阻断启动

## 用户偏好

- 语言：简体中文
- 风格：简洁、行动优先
- 回复跟随用户语言，默认中文
