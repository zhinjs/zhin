# @zhin.js/plugin-qrcode

Zhin.js plugin for qrcode functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-qrcode
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `qrcode` instance in 主配置 `plugins` 映射. The corresponding `zhin.config.yml` node is:

```yaml
configVersion: 2
plugins:
  qrcode: "@zhin.js/plugin-qrcode"
qrcode: {}
```

## Configuration

This plugin currently has no configuration fields. Its [`schema.json`](./schema.json) accepts an empty object; do not place package names in a `plugins` array.

## Commands

- `gen hello beautiful world`: generate a 300 × 300 QR image.
- `gen hello --size 512` / `gen hello -s 512`: choose 64–1024 pixels.
- `scan https://example.com/qr.png`: decode an existing QR image.
- `gen --help`: show parameters, constraints and defaults.

The Endpoint determines any command prefix. An explicit `commandNamespace` adds a plugin
namespace; neither is hardcoded in the command. Generation declares text length (1–2048)
and image size in `defineCommand`; invalid values are rejected before creating the image.

## Language / 语言

命令说明和执行反馈跟随当前操作语言（简体中文或英文）；用户输入与第三方内容保持原样，不进行自动翻译。语言与时区、权限和实际执行行为独立。参见[官方插件语言说明](../../README.md#语言与内容)。

Command feedback follows the operation language. User input and third-party content remain unchanged. See the [localization guide](../../../docs/en/configuration/localization.md).
