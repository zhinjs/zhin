# Zhin.js Docker deployment

Zhin.js does not currently publish an official container image. Do not use
`ghcr.io/zhinjs/zhin`: that legacy image path and its custom entrypoint are not
part of the supported runtime contract.

Use the project-built, lockfile-pinned templates instead:

- [中文生产部署指南](docs/operations/production.md)
- [English production guide](docs/en/operations/production.md)
- [Downloadable Docker Compose, systemd, and Kubernetes templates](docs/public/deploy/production/)

The templates build your Bot project with `pnpm install --frozen-lockfile`, run
the canonical `pnpm start` script in the foreground (`zhin start --foreground
--mode production --no-watch`: the container's main process is the management
gateway, which supervises the bot instance), persist `data/` and `.zhin/`, bind
the local Compose port to loopback, and expose `/pub/health` for process probes.

On the first deployment, create the Console owner before you expose the port.
`HTTP_TOKEN` is only a bootstrap token: it can create the first owner and is
refused everywhere once an owner exists. Use a random value and run, for example:

```bash
printf '%s\n' "$OWNER_PASSWORD" | docker compose exec -T zhin ./node_modules/.bin/zhin console init -y --owner admin --password-stdin
```

See "Creating the first owner" in the production guide for the systemd and
Kubernetes variants. Run `pnpm check:deployment-templates` in this repository to
validate their contract.
