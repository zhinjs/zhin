# Zhin.js Plugin Runtime Playground — Hugging Face Spaces
# npm install (no monorepo). tsx loads published plugin.ts under node_modules
# (Node --experimental-strip-types cannot strip types inside node_modules).

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@9.0.2 --activate

WORKDIR /app

COPY package.json ./
RUN pnpm install

COPY zhin.config.yml tsconfig.json plugin.ts ./
COPY commands ./commands

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production \
  CI=true \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  NODE_OPTIONS=--import=tsx \
  ZHIN_PROJECT_ROOT=/app \
  ZHIN_SUPERVISOR_PID=1

EXPOSE 7860

ENTRYPOINT ["tini", "--"]
CMD ["./node_modules/.bin/zhin", "runtime", "start", "--mode", "production", "--no-watch"]
