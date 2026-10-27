#!/bin/sh
# Runs as root only long enough to install firewall rules, then starts each service as its own
# unprivileged user. Required env (set by the controller, never secrets of the platform):
#   RUN_WS_PATH        random per-run path for the Playwright server (e.g. /pw-<random>)
#   ODDHOUND_LAB_MODE / ODDHOUND_LAB_ENDPOINTS   local lab only; exact ip:port pairs
set -eu

: "${RUN_WS_PATH:?RUN_WS_PATH is required}"

PW_UID=$(id -u pwuser)
PROXY_UID=$(id -u oddproxy)
sed -e "s/@PW_UID@/${PW_UID}/g" -e "s/@PROXY_UID@/${PROXY_UID}/g" /etc/oddhound/nftables.conf > /tmp/oddhound-nft.conf
if nft -f /tmp/oddhound-nft.conf; then
  echo '{"nftables":"applied"}'
else
  echo '{"nftables":"failed"}'
  # Without the firewall the browser could bypass the proxy. Refuse to start.
  exit 70
fi
rm -f /tmp/oddhound-nft.conf

setpriv --reuid=oddproxy --regid=oddproxy --clear-groups --inh-caps=-all --bounding-set=-all \
  env -i PATH=/usr/local/bin:/usr/bin:/bin ODDHOUND_LAB_MODE="${ODDHOUND_LAB_MODE:-}" ODDHOUND_LAB_ENDPOINTS="${ODDHOUND_LAB_ENDPOINTS:-}" \
  /usr/local/bin/node26 /opt/oddhound/proxy-main.ts &

exec setpriv --reuid=pwuser --regid=pwuser --init-groups --inh-caps=-all --bounding-set=-all \
  env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/pwuser PLAYWRIGHT_BROWSERS_PATH=/ms-playwright RUN_WS_PATH="${RUN_WS_PATH}" \
  /usr/local/bin/node26 /opt/oddhound/browser-server.ts
