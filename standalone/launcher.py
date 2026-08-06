"""Standalone Gramps Connect server.

Bundles gramps-web-api (as the backend) with app/'s production build (as
the frontend) and Gramps' own example.gramps sample database, so a tester
can run one executable with no separate install, server, or database setup.

On first run: creates an isolated GRAMPSHOME under DATA_DIR, an admin user,
a single tree, and imports example.gramps into it. On later runs, reuses
what's already there. Not idempotent against a manually-deleted-but-not-
fully-deleted DATA_DIR -- delete the whole directory to start over.
"""

from __future__ import annotations

import os
import sys
import time
import webbrowser
from threading import Thread

APP_NAME = "gramps-connect-demo"
TREE_NAME = "gramps-connect-demo"
ADMIN_USER = "admin"
ADMIN_PASSWORD = "admin"
HOST = "127.0.0.1"
PORT = 5050


def resource_path(*parts: str) -> str:
    """Path to a bundled resource -- works both from source and frozen."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)


def data_path(*parts: str) -> str:
    base = os.path.join(os.path.expanduser("~"), f".{APP_NAME}")
    return os.path.join(base, *parts) if parts else base


# GRAMPSHOME must be set before the first `import gramps` anywhere in the
# process (gramps.gen.const computes USER_HOME/USER_DATA at import time) --
# this isolates the demo's data from any real Gramps install on the tester's
# machine, so it's safe to try and safe to delete.
os.environ["GRAMPSHOME"] = data_path()

# Only meaningful for a source checkout (see gramps.gen.utils.resourcepath) --
# a frozen build overrides this once GRAMPS_RESOURCES is bundled alongside
# the executable.
if getattr(sys, "_MEIPASS", None):
    os.environ["GRAMPS_RESOURCES"] = resource_path("gramps-resources")


def ensure_gramps_dirs() -> None:
    """Pre-create the directories gramps/gramps-web-api expect to already
    exist -- normally done by Gramps' own GUI/CLI startup path
    (grampsapp.py's USER_DIRLIST loop), which gramps-web-api never runs."""
    os.makedirs(data_path("gramps", "grampsdb"), exist_ok=True)


def build_config() -> dict:
    os.makedirs(data_path(), exist_ok=True)
    # gramps_webapi.api.file.FileHandler raises ValueError if this doesn't
    # already exist on disk -- unconditional (not just first-run) so a
    # tester who manually deletes just this subdirectory doesn't get a
    # 500 on every media/thumbnail request instead of a self-healing dir.
    os.makedirs(data_path("media"), exist_ok=True)
    return {
        "TREE": TREE_NAME,
        "SECRET_KEY": "gramps-connect-demo-not-a-real-secret",
        "USER_DB_URI": f"sqlite:///{data_path('users.sqlite')}",
        "STATIC_PATH": resource_path("frontend"),
        "MEDIA_BASE_DIR": data_path("media"),
        "SEARCH_INDEX_DB_URI": f"sqlite:///{data_path('search.sqlite')}",
        "DISABLE_TELEMETRY": True,
        "CORS_ORIGINS": "*",
    }


def copy_example_media() -> None:
    """example.gramps' <file src="..."/> references are plain filenames,
    resolved by gramps-web-api relative to MEDIA_BASE_DIR -- the actual
    image files live alongside example.gramps in the gramps source tree
    (bundled as the "example-media" resource) and need to land there."""
    import shutil

    media_dir = data_path("media")
    src_dir = resource_path("example-media")
    for name in os.listdir(src_dir):
        if name.endswith((".gramps", ".md")):
            continue  # example.gramps itself + image_credits.md, not media
        shutil.copy2(os.path.join(src_dir, name), os.path.join(media_dir, name))


def first_run_setup(app) -> None:
    from gramps_webapi.auth import add_user, user_db
    from gramps_webapi.auth.const import ROLE_OWNER
    from gramps_webapi.dbmanager import WebDbManager
    from gramps_webapi.api.resources.util import run_import

    example_gramps = resource_path("example.gramps")

    copy_example_media()

    with app.app_context():
        user_db.create_all()
        add_user(
            ADMIN_USER,
            ADMIN_PASSWORD,
            fullname="Demo Admin",
            role=ROLE_OWNER,
            tree=None,
        )
        db_manager = WebDbManager(name=TREE_NAME, create_if_missing=True)
        dbstate = db_manager.get_db(readonly=False)
        try:
            run_import(
                db_handle=dbstate.db,
                file_name=example_gramps,
                extension="gramps",
                delete=False,
            )
        finally:
            dbstate.db.close()


def open_browser_later() -> None:
    time.sleep(1.5)
    webbrowser.open(f"http://{HOST}:{PORT}")


def main() -> None:
    first_run = not os.path.isdir(data_path())
    ensure_gramps_dirs()
    config = build_config()

    from gramps_webapi.app import create_app

    app = create_app(config=config, config_from_env=False)

    if first_run:
        print(f"First run -- setting up demo tree in {data_path()} ...")
        first_run_setup(app)

    Thread(target=open_browser_later, daemon=True).start()
    print(f"Gramps Connect demo running at http://{HOST}:{PORT}")
    print(f"Log in as {ADMIN_USER} / {ADMIN_PASSWORD}")
    print("Press Control+C to quit")
    app.run(host=HOST, port=PORT, threaded=True)


if __name__ == "__main__":
    main()
