# @zhin.js/plugin-short-url

Zhin.js plugin for short-url functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-short-url
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `short-url` instance in 主配置 `plugins` 映射. The corresponding `zhin.config.yml` node is:

```yaml
configVersion: 2
plugins:
  short-url: "@zhin.js/plugin-short-url"
short-url: {}
```

## Configuration

This plugin currently has no configuration fields. Its `plugin.ts` declares `config: Schema.object({})`, shared by Runtime validation and Console forms, and accepts an empty object; do not place package names in a `plugins` array.

## Language / 语言

命令说明和执行反馈跟随当前操作语言（简体中文或英文）；用户输入与第三方内容保持原样，不进行自动翻译。语言与时区、权限和实际执行行为独立。参见[官方插件语言说明](../../README.md#语言与内容)。

Command feedback follows the operation language. User input and third-party content remain unchanged. See the [localization guide](../../../docs/en/configuration/localization.md).
