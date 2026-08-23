# Zhin.js Docker deployment

Zhin.js does not currently publish an official container image. Do not use
`ghcr.io/zhinjs/zhin`: that legacy image path and its custom entrypoint are not
part of the supported runtime contract.

Use the project-built, lockfile-pinned templates instead:

- [中文生产部署指南](docs/operations/production.md)
- [English production guide](docs/en/operations/production.md)
- [Downloadable Docker Compose, systemd, and Kubernetes templates](docs/public/deploy/production/)

The templates build your Bot project with `pnpm install --frozen-lockfile`, run
the canonical `pnpm start` script in the foreground, persist `data/` and
`.zhin/`, bind the local Compose port to loopback, and expose `/pub/health` for
process probes. Run `pnpm check:deployment-templates` in this repository to
validate their contract.
