# @zhin.js/plugin-short-url

Zhin.js plugin for short-url functionality.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-short-url
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `short-url` instance in `package.json#zhin.plugins`. The corresponding `zhin.config.yml` node is:

```yaml
plugins:
  short-url: {}
```

## Configuration

This plugin currently has no configuration fields. Its `plugin.ts` declares `config: Schema.object({})`, shared by Runtime validation and Console forms, and accepts an empty object; do not place package names in a `plugins` array.
