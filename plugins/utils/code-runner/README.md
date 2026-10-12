# @zhin.js/plugin-code-runner

Zhin.js plugin for code-runner functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-code-runner
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `code-runner` instance in `package.json#zhin.plugins`. The corresponding `zhin.config.yml` node is:

```yaml
plugins:
  code-runner: {}
```

## Configuration

This plugin currently has no configuration fields. Its [`schema.json`](./schema.json) accepts an empty object; do not place package names in a `plugins` array.
