FROM node:24-bookworm-slim

WORKDIR /app

# Keep the package manager version aligned with pnpm-lock.yaml.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Install dependencies and build without copying any runtime secrets into the image.
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @workspace/api-server run build \
  && pnpm store prune

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]