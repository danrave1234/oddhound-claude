# oddhound-web image: Next.js app + worker (same image, two Fly process groups).
# Build from the workspace root: docker build -f apps/web/Dockerfile -t oddhound-web .
FROM node:26-bookworm-slim AS build
WORKDIR /app
RUN corepack --version >/dev/null 2>&1 || npm i -g pnpm@11.9.0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/fixture/package.json apps/fixture/
COPY apps/browser/ apps/browser/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN cd apps/web && node scripts/next-with-env.mjs build

FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# The worker only connects to remote browsers (chromium.connect); it needs no local browser.
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "apps/web/scripts/next-with-env.mjs", "start", "--port", "8080", "--hostname", "0.0.0.0"]
