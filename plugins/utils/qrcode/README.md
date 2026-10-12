# @zhin.js/plugin-qrcode

Zhin.js plugin for qrcode functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-qrcode
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `qrcode` instance in `package.json#zhin.plugins`. The corresponding `zhin.config.yml` node is:

```yaml
plugins:
  qrcode: {}
```

## Configuration

This plugin currently has no configuration fields. Its [`schema.json`](./schema.json) accepts an empty object; do not place package names in a `plugins` array.
