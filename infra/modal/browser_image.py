"""Build the secret-free per-run browser image on Modal and print its pinned image ID.

    python infra/modal/browser_image.py            # from the repository root

The image is apps/browser/Dockerfile unchanged (Playwright 1.64.1 server, egress proxy, nftables,
non-root Chromium). ENTRYPOINT is cleared because the worker passes the entrypoint explicitly as the
Sandbox command. Put the printed im-... value in MODAL_BROWSER_IMAGE_ID (infra/modal/app.py).
"""
import pathlib

import modal

ROOT = pathlib.Path(__file__).resolve().parents[2]

image = modal.Image.from_dockerfile(
    ROOT / "apps/browser/Dockerfile",
    context_dir=ROOT,
).dockerfile_commands(["ENTRYPOINT []"])

if __name__ == "__main__":
    app = modal.App.lookup("oddhound-browser", create_if_missing=True)
    with modal.enable_output():
        built = image.build(app)
    print(f"MODAL_BROWSER_IMAGE_ID={built.object_id}")
