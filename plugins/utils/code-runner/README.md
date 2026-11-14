# @zhin.js/plugin-code-runner

Zhin.js plugin for code-runner functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-code-runner
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `code-runner` instance in 主配置 `plugins` 映射. The corresponding `zhin.config.yml` node is:

```yaml
configVersion: 2
plugins:
  code-runner: "@zhin.js/plugin-code-runner"
code-runner:
  provider: piston                     # piston | glot
  endpoint: ${CODE_RUNNER_ENDPOINT}    # e.g. http://127.0.0.1:2000/api/v2/execute
  token: ${CODE_RUNNER_TOKEN}          # optional secret
```

## Configuration

代码在**你配置的后端**里执行，插件不内置任何公共服务地址。以前写死的 `https://glot.io/api/run` 已不可用（404），
emkc.org 的公共 Piston API 自 2026-02-15 起只对白名单开放，因此没有可靠的公开默认后端。未配置 `endpoint` 时，
`run` 命令和 `run_code` 工具会回复「未配置代码运行后端，请在配置里设置 endpoint」，不会发出请求。

| Field | Default | Description |
|-------|---------|-------------|
| `provider` | `piston` | 后端协议。`piston`：POST `{endpoint}`，请求体 `{ language, version: "*", files }`（[Piston](https://github.com/engineer-man/piston) 自建实例的 `/api/v2/execute`）。`glot`：POST `{endpoint}/{language}/latest`，请求体 `{ files }`（glot.io 兼容服务）。 |
| `endpoint` | `""` | 后端地址；支持 `${ENV}` 引用。值为未展开的 `${…}`（环境变量缺失）时视为未配置。 |
| `token` | — | 可选访问令牌（secret 字段，Console 不回显），建议写 `${CODE_RUNNER_TOKEN}`。piston 原样作为 `Authorization` 头；glot 发送 `Authorization: Token <token>`。 |

Self-hosting Piston (one option):

```bash
docker run -d --name piston -p 2000:2000 --privileged ghcr.io/engineer-man/piston
# then install the runtimes you need, see the Piston README
```

The code runs on that backend, not on the bot host; its isolation, network and filesystem access are whatever the backend enforces.

## Commands

- `run javascript console.log("hello")` / `run js console.log("hello")`: execute with the default 30-second timeout.
- `run python --timeout 5 print(1)` / `run python -t 5 print(1)`: choose 1–30 seconds.
- `run --help`: show supported languages, code constraints and timeout defaults.

Languages: `python`, `javascript`, `typescript`, `bash`, `go`, `rust`, `java`, `c`, `cpp`, `ruby`, `php`.
Aliases (case-insensitive): `js` / `node` / `nodejs` → javascript, `ts` → typescript, `py` / `py3` / `python3` → python,
`sh` / `shell` → bash, `c++` / `cxx` / `cc` → cpp, `rb` → ruby, `golang` → go, `rs` → rust.

The Endpoint determines any command prefix, and an explicit `commandNamespace` adds a plugin
namespace. `commands/run/[language]/index.ts` binds the language, while code and timeout are
centrally declared in the same definition. Code keeps quotes and newlines; its limit is
10,000 characters. Use `--` before code containing option-like words. Unsupported languages,
missing code and invalid timeout values are rejected before the remote request.

## Language / 语言

命令说明和执行反馈跟随当前操作语言（简体中文或英文）；用户输入与第三方内容保持原样，不进行自动翻译。语言与时区、权限和实际执行行为独立。参见[官方插件语言说明](../../README.md#语言与内容)。

Command feedback follows the operation language. User input and third-party content remain unchanged. See the [localization guide](../../../docs/en/configuration/localization.md).
