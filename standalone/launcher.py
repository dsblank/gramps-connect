"""Standalone Gramps Connect server.

Bundles gramps-web-api (as the backend) with app/'s production build (as
the frontend), so a tester can run one executable with no separate install,
server, or database setup.

On first run: creates an isolated GRAMPSHOME under DATA_DIR, an admin user,
and a single empty tree -- ready to import a Gramps XML (.gramps) or
GEDCOM (.ged) file into via the app's own Family Trees -> Import... screen.
On later runs, reuses what's already there. Not idempotent against a
manually-deleted-but-not-fully-deleted DATA_DIR -- delete the whole
directory to start over.
"""

from __future__ import annotations

import io
import os
import socket
import sys
import time
import webbrowser
from threading import Thread

import webview
from PIL import Image

APP_NAME = "gramps-connect-desktop"
TREE_NAME = "gramps-connect-desktop"
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
# this isolates gramps-connect-desktop's data from any real Gramps install
# on the tester's machine, so it's safe to try and safe to delete.
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
        "SECRET_KEY": "gramps-connect-desktop-not-a-real-secret",
        "USER_DB_URI": f"sqlite:///{data_path('users.sqlite')}",
        "STATIC_PATH": resource_path("frontend"),
        "MEDIA_BASE_DIR": data_path("media"),
        "SEARCH_INDEX_DB_URI": f"sqlite:///{data_path('search.sqlite')}",
        "DISABLE_TELEMETRY": True,
        "CORS_ORIGINS": "*",
    }


def wait_for_server() -> None:
    """Block until the Flask server's socket is accepting connections, so
    the webview doesn't navigate to it before it's ready."""
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex((HOST, PORT)) == 0:
                return
        time.sleep(0.05)


def install_avif_transcoder(app) -> None:
    """Rewrite image/avif responses to JPEG before they reach the webview.

    gramps-web-api's thumbnail endpoints serve AVIF unless the request's
    Accept header explicitly lists image/avif -- but Ubuntu's stock
    WebKitGTK (confirmed on 2.52.3, no libavif/dav1d linked) both sends
    "image/avif" in its default image Accept header (a spec-mandated
    default, unrelated to whether the engine was actually built with an
    AVIF decoder) and then can't decode the bytes it asked for: the
    request 200s, and the <img> just renders blank, with no console error
    or broken-image fallback. Server-side Accept negotiation can't fix
    that -- the header lies about decode capability -- so this decodes
    and re-encodes here instead, in the one process that actually has the
    broken renderer, using the Pillow this app already depends on. Every
    other client of gramps-web-api (browsers with real AVIF support, the
    sync/backup tools, plain API callers) is untouched, since this hook
    only runs inside this bundled process.
    """

    @app.after_request
    def _transcode_avif(response):
        if response.status_code != 200 or response.mimetype != "image/avif":
            return response
        response.direct_passthrough = False
        with Image.open(io.BytesIO(response.get_data())) as img:
            if img.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
                img = background
            else:
                img = img.convert("RGB")
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=85)
        response.set_data(buffer.getvalue())
        response.headers["Content-Type"] = "image/jpeg"
        if "ETag" in response.headers:
            response.headers["ETag"] = response.headers["ETag"].rstrip('"') + '-jpeg"'
        return response


def first_run_setup(app) -> None:
    from gramps_webapi.auth import add_user, user_db
    from gramps_webapi.auth.const import ROLE_OWNER
    from gramps_webapi.dbmanager import WebDbManager

    with app.app_context():
        user_db.create_all()
        add_user(
            ADMIN_USER,
            ADMIN_PASSWORD,
            fullname="Admin",
            role=ROLE_OWNER,
            tree=None,
        )
        db_manager = WebDbManager(name=TREE_NAME, create_if_missing=True)
        dbstate = db_manager.get_db(readonly=False)
        dbstate.db.close()


def main() -> None:
    first_run = not os.path.isdir(data_path())
    ensure_gramps_dirs()
    config = build_config()

    from gramps_webapi.app import create_app

    app = create_app(config=config, config_from_env=False)
    install_avif_transcoder(app)

    if first_run:
        print(f"First run -- setting up tree in {data_path()} ...")
        first_run_setup(app)

    # Flask's dev server blocks, so it runs on a background thread; the
    # webview needs the main thread for its native event loop (required on
    # macOS/Cocoa, and pywebview enforces it on every platform for
    # consistency).
    #
    # threaded=False (Werkzeug's own default, spelled out here to be
    # explicit) is deliberate, not a missed perf knob: Gramps' sqlite DBAPI
    # backend (gramps/gen/db/generic.py's close()) calls
    # self._set_all_metadata() -- a write -- *before* self._close(), with
    # no try/finally between them. Two connections racing under a threaded
    # server (e.g. a large import's teardown overlapping the page reload's
    # own requests) can make that metadata write hit SQLite's "database is
    # locked", which raises out of close() before self._close() ever runs
    # -- leaking that connection's lock permanently, wedging the tree for
    # every future request until the whole process is killed. Confirmed
    # live: a real ~10k-object import followed immediately by the client's
    # post-import reload reproduced exactly this, and it never recovered.
    # This is a single-user local app with no need for concurrent
    # request handling, so serializing every request through one thread
    # sidesteps the race entirely rather than patching around it here.
    server_thread = Thread(
        target=app.run,
        kwargs={"host": HOST, "port": PORT, "threaded": False},
        daemon=True,
    )
    server_thread.start()
    wait_for_server()
    print(f"Gramps Connect Desktop running at http://{HOST}:{PORT}")
    print(f"Log in as {ADMIN_USER} / {ADMIN_PASSWORD}")

    # pywebview defaults ALLOW_DOWNLOADS to False, which on the GTK backend
    # means it never even connects WebKit's download-started signal --
    # clicking a report/export "Download" link still gets marked for
    # download internally (on_navigation's decide-policy handler calls
    # decision.download() regardless), but nothing is listening for it, so
    # it just silently vanishes with no error, dialog, or file. Enabling
    # this makes pywebview wire up a native GTK save-file dialog instead
    # (webview/platforms/gtk.py's on_download_decide_destination).
    webview.settings["ALLOW_DOWNLOADS"] = True

    webview.create_window(APP_NAME, f"http://{HOST}:{PORT}")
    try:
        # webview.start() resolves the platform backend (GTK/Qt on Linux,
        # WKWebView on macOS, WebView2 on Windows) before showing anything --
        # it raises WebViewException synchronously if none is found, so this
        # is a safe point to fall back rather than a partial/failed launch.
        #
        # private_mode=False: pywebview defaults to private_mode=True, which
        # on the GTK backend explicitly disables WebKit's local storage/
        # IndexedDB (enable_html5_local_storage=False) -- not flaky, just
        # off. That breaks anything using localStorage with no defensive
        # try/catch (confirmed live: browserNotifications.ts's
        # notifyBrowser(), fired on report/job completion, throws
        # "Can't find variable: localStorage" since the API isn't merely
        # empty but doesn't exist as a global at all), and silently no-ops
        # column-width/search-state/map-viewport persistence besides. This
        # is a single-user local app that already persists real data to
        # disk (GRAMPSHOME under DATA_DIR) -- there's no incognito-style
        # privacy need here, so private browsing was actively working
        # against the app's own design. storage_path keeps the resulting
        # WebKit profile under DATA_DIR too, consistent with "delete this
        # folder to reset" covering everything, not just the tree.
        webview.start(private_mode=False, storage_path=data_path("webkit-storage"))
    except Exception as exc:
        # webview.WebViewException covers "no backend found at all", but a
        # host whose real GTK/WebKit2 gi bindings import fine (see
        # rthook_gi_stub.py's _try_real_gi()) yet fail at actual use --
        # e.g. an ABI/library-version mismatch -- surfaces as some other
        # exception type from deep inside pywebview's GTK backend (seen in
        # practice: gi.repository.GLib.GError from a failed native call).
        # Anything here means no working native window either way, so fall
        # back the same way rather than crashing.
        print(f"Native webview backend unavailable ({exc}) -- opening in your browser instead.")
        webbrowser.open(f"http://{HOST}:{PORT}")
        print("Press Control+C to quit")
        server_thread.join()


if __name__ == "__main__":
    main()
