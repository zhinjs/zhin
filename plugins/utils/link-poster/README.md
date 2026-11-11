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

## Network policy

Only links on the supported platform hosts are fetched. Every request, including each redirect
hop and every cover/avatar image taken from third-party metadata, must also resolve to public
addresses only (loopback, private, link-local and cloud-metadata targets are refused). Requests
time out after 10 seconds; page/API bodies above 2 MB and images above 5 MB are dropped. The poster is rendered after the
rest of the middleware chain has handled the message, so slow link fetching does not delay
commands or the Agent.

## Configuration

This plugin currently has no configuration fields. Its [`schema.json`](./schema.json) accepts an empty object; do not place package names in a `plugins` array.
