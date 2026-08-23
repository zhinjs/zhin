FROM node:24-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@9.0.2 --activate

WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
RUN pnpm build
# Keep the installed CLI: generated Zhin projects invoke it from `pnpm start`.

FROM node:24-bookworm-slim AS runtime

RUN corepack enable && corepack prepare pnpm@9.0.2 --activate

WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data /app/.zhin && chown -R node:node /app/data /app/.zhin

ENV NODE_ENV=production
ENV TZ=UTC

USER node
EXPOSE 8068

CMD ["pnpm", "start"]
