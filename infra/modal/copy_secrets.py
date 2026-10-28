"""Create the Modal Secrets from values piped in as NAME=VALUE lines. Prints names only, never values.

    fly ssh console -a oddhound-claude-web -C printenv | python infra/modal/copy_secrets.py

Also adds MODAL_TOKEN_ID/MODAL_TOKEN_SECRET from ~/.modal.toml (the worker needs them to create browser
Sandboxes; the web app needs them to wake the worker). Re-running replaces the Secrets.
"""
import pathlib
import sys
import tomllib

import modal

WEB = ["DATABASE_URL", "META_API_KEY", "BETTER_AUTH_SECRET", "ODDHOUND_CREDENTIAL_KEY",
       "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ODDHOUND_FIXTURE_RESET_TOKEN"]
FIXTURE = ["ODDHOUND_FIXTURE_RESET_TOKEN"]

values: dict[str, str] = {}
for line in sys.stdin.read().splitlines():
    name, sep, value = line.strip().partition("=")
    if sep and name in WEB:
        values[name] = value

missing = [n for n in WEB if not values.get(n)]
if missing:
    sys.exit(f"missing from input: {', '.join(missing)}")

cfg = tomllib.loads((pathlib.Path.home() / ".modal.toml").read_text())
profile = next((p for p in cfg.values() if isinstance(p, dict) and p.get("active")), None) or next(p for p in cfg.values() if isinstance(p, dict))
web = {n: values[n] for n in WEB} | {"MODAL_TOKEN_ID": profile["token_id"], "MODAL_TOKEN_SECRET": profile["token_secret"]}
fixture = {n: values[n] for n in FIXTURE}

for name, env in (("oddhound-web", web), ("oddhound-fixture", fixture)):
    try:
        modal.Secret.objects.delete(name)
    except Exception:
        pass
    modal.Secret.objects.create(name, env)
    print(f"{name}: {', '.join(sorted(env))}")
