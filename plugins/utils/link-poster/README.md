# @zhin.js/plugin-link-poster

Zhin.js plugin for link-poster functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-link-poster
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `link-poster` instance in `package.json#zhin.plugins`. The corresponding `zhin.config.yml` node is:

```yaml
plugins:
  link-poster: {}
```

## Configuration

This plugin currently has no configuration fields. Its [`schema.json`](./schema.json) accepts an empty object; do not place package names in a `plugins` array.
