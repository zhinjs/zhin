# @zhin.js/plugin-link-poster

Zhin.js plugin for link-poster functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-link-poster
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `link-poster` instance in 主配置 `plugins` 映射. The corresponding `zhin.config.yml` node is:

```yaml
configVersion: 2
plugins:
  link-poster: "@zhin.js/plugin-link-poster"
link-poster: {}
```

## Configuration

This plugin currently has no configuration fields. Its [`schema.json`](./schema.json) accepts an empty object; do not place package names in a `plugins` array.
