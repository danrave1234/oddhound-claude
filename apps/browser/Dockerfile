# oddhound-browser: the secret-free, per-run browser image.
# One container (locally) or one Fly Machine (deployed) per run. It holds NO platform credentials:
# no model keys, database URL, storage keys or Fly token. It runs:
#   * egress proxy (user "oddproxy"): SSRF-safe forward proxy, the only route out;
#   * Playwright browser server (user "pwuser"): Chromium with its own sandbox ON, fixed launch options;
#   * nftables: the browser user may only reach the local proxy; everything else from it is dropped.
FROM node:26-bookworm-slim AS node26

FROM mcr.microsoft.com/playwright:v1.64.1-noble
COPY --from=node26 /usr/local/bin/node /usr/local/bin/node26
RUN apt-get update \
 && apt-get install -y --no-install-recommends nftables tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home --shell /usr/sbin/nologin oddproxy

WORKDIR /opt/oddhound
RUN printf '{"name":"oddhound-browser","private":true,"type":"module"}' > package.json \
 && npm install --no-audit --no-fund --omit=dev playwright@1.64.1 \
 && chown -R root:root /opt/oddhound

# Only the files the image needs: the proxy, its address policy, and the browser server.
COPY packages/core/net/ip-policy.ts packages/core/net/safe-fetch.ts packages/core/net/egress-proxy.ts ./core/net/
COPY packages/core/contracts/limits.ts ./core/contracts/
COPY apps/browser/proxy-main.ts apps/browser/browser-server.ts apps/browser/netcheck.ts ./
COPY apps/browser/nftables.conf /etc/oddhound/nftables.conf
COPY apps/browser/entrypoint.sh /usr/local/bin/oddhound-entrypoint
# Normalise line endings so a Windows checkout cannot break the shell script or the nft rules.
RUN sed -i 's/\r$//' /usr/local/bin/oddhound-entrypoint /etc/oddhound/nftables.conf \
 && chmod 0755 /usr/local/bin/oddhound-entrypoint \
 && chmod -R a-w /opt/oddhound /etc/oddhound

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/oddhound-entrypoint"]
