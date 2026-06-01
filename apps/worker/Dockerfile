# Playwright base image ships Chromium + system deps for headless crawling.
FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app
ENV NODE_ENV=production

# Enable pnpm via corepack.
RUN corepack enable

# Install workspace deps (copy manifests first for layer caching).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @retailer/worker...

# Health endpoint.
EXPOSE 8080

CMD ["pnpm", "--filter", "@retailer/worker", "start"]
