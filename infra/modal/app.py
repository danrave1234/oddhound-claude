"""Oddhound on Modal: web app, run worker and demo targets. Per-run browsers are Modal Sandboxes created
by the worker (packages/core/browser/modal-runtime.ts), in the separate secret-free app "oddhound-browser".

Deploy from a clean export of committed code (see infra/modal/README.md):

    ODDHOUND_MODAL_WORKSPACE=<workspace> MODAL_BROWSER_IMAGE_ID=im-... modal deploy infra/modal/app.py

Secrets (Modal Secrets, never in this file):
  oddhound-web      DATABASE_URL, META_API_KEY, BETTER_AUTH_SECRET, ODDHOUND_CREDENTIAL_KEY,
                    GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ODDHOUND_FIXTURE_RESET_TOKEN,
                    MODAL_TOKEN_ID, MODAL_TOKEN_SECRET (worker creates Sandboxes; web wakes the worker)
  oddhound-fixture  ODDHOUND_FIXTURE_RESET_TOKEN
The browser Sandboxes receive none of these.
"""
import os
import pathlib
import subprocess

import modal

# Deploy-time settings. Inside a container this file is re-imported from /root, without these variables:
# everything a process needs is passed through each Function's `env`, fixed when it was deployed.
ROOT = pathlib.Path(__file__).resolve().parents[2] if modal.is_local() else pathlib.Path("/")
WORKSPACE = os.environ.get("ODDHOUND_MODAL_WORKSPACE", "")
BROWSER_IMAGE_ID = os.environ.get("MODAL_BROWSER_IMAGE_ID", "")
# gVisor cannot install the browser-user firewall (no netfilter netlink; canary Oct 28), so browsers run as VMs.
SANDBOX_RUNTIME = os.environ.get("MODAL_SANDBOX_RUNTIME", "vm")


URL_SUFFIX = os.environ.get("ODDHOUND_MODAL_URL_SUFFIX", "us-east.modal.run")


def url(label: str) -> str:
    return f"https://{WORKSPACE}--{label}.{URL_SUFFIX}"


app = modal.App("oddhound")

# The same images as on Fly, built from the repository Dockerfiles. Modal needs Python in the image to
# run its function wrapper; the Node processes still run as the unprivileged "node" user.
web_image = (
    modal.Image.from_dockerfile(ROOT / "apps/web/Dockerfile", context_dir=ROOT, add_python="3.12")
    .dockerfile_commands(["USER root", "ENTRYPOINT []"])
)
fixture_image = (
    modal.Image.from_dockerfile(ROOT / "apps/fixture/Dockerfile", context_dir=ROOT, add_python="3.12")
    .dockerfile_commands(["USER root", "ENTRYPOINT []"])
)

web_secret = modal.Secret.from_name("oddhound-web")
fixture_secret = modal.Secret.from_name("oddhound-fixture")

COMMON_ENV = {
    "NODE_ENV": "production",
    "NEXT_TELEMETRY_DISABLED": "1",
    "ARTIFACT_STORE": "db",
    "ODDHOUND_ADMIN_EMAILS": "danravekeh123@gmail.com",
    "META_REASONING_EFFORT": "low",
    # Development only (same as Fly): Muse Spark 1.3 at the "contributor" price. Remove before other
    # owners' sites are scanned.
    "META_MODEL": "muse-spark-1.3-contributor",
    "BETTER_AUTH_URL": url("oddhound-web"),
    "DEMO_TARGET_ORIGIN": url("oddhound-demo"),
    "DEMO_TARGET_RESET_URL": url("oddhound-demo") + "/__lab/reset",
    "DEMO_TARGET_FIXED_ORIGIN": url("oddhound-demo-fixed"),
    "DEMO_TARGET_FIXED_RESET_URL": url("oddhound-demo-fixed") + "/__lab/reset",
    "BROWSER_RUNTIME": "modal",
    "MODAL_BROWSER_APP": "oddhound-browser",
    "MODAL_BROWSER_IMAGE_ID": BROWSER_IMAGE_ID,
    "MODAL_SANDBOX_RUNTIME": SANDBOX_RUNTIME,
    "MODAL_CONNECT": "token",
    "MODAL_OUTBOUND": "public",
    "WORKER_WAKE": "modal",
    # Own queue while the Fly deployment still runs against the same database.
    "ODDHOUND_RUN_QUEUE": "oddhound-runs-modal",
    "MODAL_APP": "oddhound",
    "MODAL_WORKER_FUNCTION": "worker",
}


# Modal's in-container variables point its SDKs at a root-only local socket and carry a container
# identity token. The Node processes use the Modal token from the oddhound-web Secret against the public
# API instead, and never see the identity token.
CONTAINER_ONLY = {"MODAL_SERVER_URL", "MODAL_IDENTITY_TOKEN", "MODAL_IDENTITY_TOKEN_FILE", "MODAL_IS_REMOTE",
                  "MODAL_TASK_ID", "MODAL_CONTAINER_ARGUMENTS_PATH", "MODAL_REGION"}


def node(args: list[str], cwd: str, extra_env: dict | None = None, wait: bool = False):
    base = {k: v for k, v in os.environ.items() if k not in CONTAINER_ONLY}
    env = {**base, **(extra_env or {}), "MODAL_SERVER_URL": "https://api.modal.com", "HOME": "/home/node"}
    p = subprocess.Popen(["node", *args], cwd=cwd, env=env, user="node", group="node")
    if wait:
        code = p.wait()
        if code != 0:
            raise RuntimeError(f"node exited with {code}")
    return p


@app.function(image=web_image, secrets=[web_secret], env=COMMON_ENV, cpu=0.5, memory=1024, min_containers=0, scaledown_window=120, timeout=3600)
@modal.concurrent(max_inputs=50)
@modal.web_server(8080, startup_timeout=90, label="oddhound-web")
def web():
    node(["scripts/next-with-env.mjs", "start", "--port", "8080", "--hostname", "0.0.0.0"], cwd="/app/apps/web")


@app.function(image=web_image, secrets=[web_secret], env=COMMON_ENV, cpu=0.5, memory=1024, max_containers=1, timeout=24 * 3600)  # runs drain back to back; 2 h cut a second run short
def worker(idle_exit_ms: int = 90_000):
    """Drains the Postgres run queue, runs the reapers, and exits after idle_exit_ms with no active run."""
    node(["/app/apps/worker/main.ts"], cwd="/app", extra_env={"ODDHOUND_WORKER_IDLE_EXIT_MS": str(int(idle_exit_ms))}, wait=True)


@app.function(image=web_image, schedule=modal.Period(minutes=15), timeout=60)
def tick():
    """Safety net: starts the worker so stranded queue entries and orphaned Sandboxes are handled even
    if a wake-up from the web app was lost. Sandboxes also carry a hard Modal timeout of their own."""
    worker.spawn(idle_exit_ms=15_000)


def fixture(mode: str):
    def serve():
        node(["server.ts"], cwd="/app", extra_env={"FIXTURE_PORT": "8080", "FIXTURE_HOST": "0.0.0.0", "FIXTURE_MODE": mode})
    return serve


# The demo targets keep their synthetic state in memory, so each runs at most one container.
@app.function(image=fixture_image, secrets=[fixture_secret], cpu=0.25, memory=256, min_containers=0, max_containers=1, scaledown_window=600, name="demo")
@modal.concurrent(max_inputs=50)
@modal.web_server(8080, startup_timeout=30, label="oddhound-demo")
def demo():
    fixture("vulnerable")()


@app.function(image=fixture_image, secrets=[fixture_secret], cpu=0.25, memory=256, min_containers=0, max_containers=1, scaledown_window=600, name="demo_fixed")
@modal.concurrent(max_inputs=50)
@modal.web_server(8080, startup_timeout=30, label="oddhound-demo-fixed")
def demo_fixed():
    fixture("fixed")()
