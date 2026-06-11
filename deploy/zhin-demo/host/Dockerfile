FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY basic ./basic
COPY packages ./packages
COPY plugins/adapters/sandbox ./plugins/adapters/sandbox
COPY examples/demo-bot ./examples/demo-bot
RUN pnpm install --frozen-lockfile
RUN pnpm --filter demo-bot build
RUN pnpm --filter @zhin.js/host-router build
RUN pnpm --filter @zhin.js/host-api build

FROM node:22-bookworm-slim
WORKDIR /app/examples/demo-bot
ENV ZHIN_PROJECT_ROOT=/app/examples/demo-bot
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/examples/demo-bot /app/examples/demo-bot
COPY --from=build /app/packages /app/packages
COPY --from=build /app/plugins /app/plugins
COPY --from=build /app/basic /app/basic
EXPOSE 8086
CMD ["pnpm", "start"]
