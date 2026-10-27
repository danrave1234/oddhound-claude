# Demo target (Harbor Table). Synthetic data only; no secrets.
FROM node:26-bookworm-slim
WORKDIR /app
COPY apps/fixture/server.ts ./server.ts
USER node
ENV FIXTURE_HOST=0.0.0.0
EXPOSE 4310 4311
ENTRYPOINT ["node", "server.ts"]
