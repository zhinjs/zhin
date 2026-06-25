# 安装插件

Zhin 插件安装分两步：安装依赖、启用插件。推荐使用 Zhin CLI，一条命令完成两步。

## 安装并启用

```bash
npx zhin install @scope/plugin
```

执行后会：

1. 运行 `pnpm add` 安装依赖。
2. 自动检测 `zhin.config.yml` / `zhin.config.yaml` / `zhin.config.json`。
3. 将插件写入 `plugins`。
4. 提示下一步运行 `pnpm dev` 和 `zhin doctor`。

`zhin add` 是同义命令：

```bash
npx zhin add @scope/plugin
```

## 预览改动

```bash
npx zhin install @scope/plugin --dry-run
```

dry-run 不会安装依赖，也不会写配置，只打印将执行的 `pnpm add` 和将写入的插件名。

## 只安装不启用

```bash
npx zhin install @scope/plugin --no-enable
```

适合你想手动编辑配置、或要先检查插件 README 的场景。

## 安装适配器

适配器也是插件：

```bash
npx zhin install @zhin.js/adapter-telegram
npx zhin setup --adapters
```

第一步安装并启用插件；第二步按向导写入 Endpoint 凭据。Webhook 类平台还需要公网地址或内网穿透。

## 配置结果

YAML 项目会得到类似配置：

```yaml
plugins:
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
  - "@zhin.js/adapter-sandbox"
  - "@scope/plugin"
```

JSON 项目会写入 `plugins` 数组。

## 常见问题

| 症状 | 处理 |
|------|------|
| 安装成功但插件不生效 | 确认 `plugins` 里有插件名，或重新运行 `npx zhin install <pkg>` |
| 不想自动改配置 | 使用 `--no-enable` |
| 想看会改什么 | 使用 `--dry-run` |
| Console 仍看不到能力 | 运行 `npx zhin doctor`，确认 Host/Sandbox/插件配置正常 |

更多症状见 [疑难排查](/troubleshooting/)。
