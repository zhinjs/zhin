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
code-runner: {}
```

## Configuration

This plugin currently has no configuration fields. Its [`schema.json`](./schema.json) accepts an empty object; do not place package names in a `plugins` array.

## Commands

- `run javascript console.log("hello")`: execute with the default 30-second timeout.
- `run python --timeout 5 print(1)` / `run python -t 5 print(1)`: choose 1–30 seconds.
- `run --help`: show supported languages, code constraints and timeout defaults.

The Endpoint determines any command prefix, and an explicit `commandNamespace` adds a plugin
namespace. `commands/run/[language]/index.ts` binds the language, while code and timeout are
centrally declared in the same definition. Code keeps quotes and newlines; its limit is
10,000 characters. Use `--` before code containing option-like words. Unsupported languages,
missing code and invalid timeout values are rejected before the remote request.

## Language / 语言

命令说明和执行反馈跟随当前操作语言（简体中文或英文）；用户输入与第三方内容保持原样，不进行自动翻译。语言与时区、权限和实际执行行为独立。参见[官方插件语言说明](../../README.md#语言与内容)。

Command feedback follows the operation language. User input and third-party content remain unchanged. See the [localization guide](../../../docs/en/configuration/localization.md).
