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

This plugin currently has no configuration fields. The empty, strict schema lives in `schema.json` (`plugin.ts` declares no `config`), is shared by Runtime validation and Console forms, and accepts only an empty object; do not place package names in a `plugins` array.

## Behaviour

- `shorten` (command, Agent tool and the Console "Create" action) calls the public is.gd API and returns the link it issues. The Console page lists the links created since the process started; is.gd offers no listing, click statistics or deletion, so "Remove From List" only clears the local row.
- Chat aliases: `short <url>` / `短链 <url>` for `shorten`, `short expand <url>` / `还原短链 <url>` for `expand`; the old names keep working.
- `expand` follows the redirect chain itself. Every hop must be an `http(s)` URL on a public address: loopback, private, link-local, cloud-metadata and internal host names are refused, each request times out after 10 seconds and response bodies are never read.

## Language / 语言

命令说明和执行反馈跟随当前操作语言（简体中文或英文）；用户输入与第三方内容保持原样，不进行自动翻译。语言与时区、权限和实际执行行为独立。参见[官方插件语言说明](../../README.md#语言与内容)。

Command feedback follows the operation language. User input and third-party content remain unchanged. See the [localization guide](../../../docs/en/configuration/localization.md).
