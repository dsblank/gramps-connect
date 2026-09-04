"""Standalone Gramps Connect server.

Bundles gramps-web-api (as the backend) with app/'s production build (as
the frontend), so a tester can run one executable with no separate install,
server, or database setup.

On first run: creates an isolated GRAMPSHOME under DATA_DIR, an admin user,
and a single empty tree -- ready to import a Gramps XML (.gramps) or
GEDCOM (.ged) file into via the app's own Family Trees -> Import... screen.
On later runs, reuses what's already there. ensure_setup() is idempotent
and runs on every launch (not just a detected "first run"), so a run that
crashes partway through setup self-heals on the next launch instead of
getting stuck -- see its own docstring.
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


# Outbound SMTP is opt-in: gramps-web-api's own defaults point EMAIL_HOST at
# "localhost", which has no mail server listening on a tester's machine, so
# password-reset/e-mail-confirmation/new-user-notification requests would
# otherwise just fail with "Connection was refused." Setting these mirrors
# gramps-web-api's own (non-deprecated) GRAMPSWEB_-prefixed env var names,
# which app.config.from_prefixed_env() would read automatically -- except
# create_app() is called below with config_from_env=False (this app has no
# use for gramps-web-api's other env-configurable options, e.g. TREE_MULTI,
# which don't apply to a single-tree desktop build), so it's replicated by
# hand here instead, scoped to just the e-mail keys. Booleans are parsed
# case-insensitively from "true"/"1"/"yes"/"on" (anything else is False),
# rather than reusing from_prefixed_env's default json.loads -- that would
# silently misparse e.g. "no" or "False" as truthy non-empty strings.
_EMAIL_BOOL_KEYS = ("EMAIL_USE_TLS", "EMAIL_USE_SSL", "EMAIL_USE_STARTTLS")
_EMAIL_STR_KEYS = (
    "EMAIL_HOST",
    "EMAIL_PORT",
    "EMAIL_HOST_USER",
    "EMAIL_HOST_PASSWORD",
    "DEFAULT_FROM_EMAIL",
)


def email_config_from_env() -> dict:
    """Read optional GRAMPSWEB_EMAIL_* / GRAMPSWEB_DEFAULT_FROM_EMAIL env vars.

    Unset variables are omitted entirely (rather than defaulted here) so
    gramps-web-api's own DefaultConfig values -- e.g. EMAIL_USE_TLS=True,
    EMAIL_PORT="465" -- still apply to whichever keys the tester didn't set.
    """
    config = {}
    for key in _EMAIL_STR_KEYS:
        value = os.environ.get(f"GRAMPSWEB_{key}")
        if value:
            config[key] = value
    for key in _EMAIL_BOOL_KEYS:
        value = os.environ.get(f"GRAMPSWEB_{key}")
        if value is not None:
            config[key] = value.strip().lower() in ("true", "1", "yes", "on")
    return config


def build_config() -> dict:
    os.makedirs(data_path(), exist_ok=True)
    # gramps_webapi.api.file.FileHandler raises ValueError if this doesn't
    # already exist on disk -- unconditional (not just first-run) so a
    # tester who manually deletes just this subdirectory doesn't get a
    # 500 on every media/thumbnail request instead of a self-healing dir.
    os.makedirs(data_path("media"), exist_ok=True)
    # gramps-web-api's own defaults for all five of these are Path.cwd() /
    # "<name>_cache" (or "report_cache"/"export_cache") -- fine for a
    # normal server deployment with a fixed working directory, but this app
    # can be launched from anywhere (a tester double-clicking it, or a
    # shell in whatever directory they happened to be in), so the defaults
    # littered wherever that happened to be instead of staying inside
    # DATA_DIR alongside everything else this app owns. No pre-creation
    # needed here: cachelib's FileSystemCache and gramps-web-api's own
    # report/export endpoints already os.makedirs(..., exist_ok=True)
    # themselves.
    def cache_config(name: str, threshold: int, timeout: int) -> dict:
        return {
            "CACHE_TYPE": "FileSystemCache",
            "CACHE_DIR": data_path(name),
            "CACHE_THRESHOLD": threshold,
            "CACHE_DEFAULT_TIMEOUT": timeout,
        }

    return {
        "TREE": TREE_NAME,
        "SECRET_KEY": "gramps-connect-desktop-not-a-real-secret",
        "USER_DB_URI": f"sqlite:///{data_path('users.sqlite')}",
        "STATIC_PATH": resource_path("frontend"),
        "MEDIA_BASE_DIR": data_path("media"),
        "SEARCH_INDEX_DB_URI": f"sqlite:///{data_path('search.sqlite')}",
        "REQUEST_CACHE_CONFIG": cache_config("request_cache", 1000, 0),
        "THUMBNAIL_CACHE_CONFIG": cache_config("thumbnail_cache", 1000, 0),
        "PERSISTENT_CACHE_CONFIG": cache_config("persistent_cache", 0, 0),
        "REPORT_DIR": data_path("report_cache"),
        "EXPORT_DIR": data_path("export_cache"),
        "DISABLE_TELEMETRY": True,
        "CORS_ORIGINS": "*",
        **email_config_from_env(),
    }


def wait_for_server(server_thread: Thread, timeout: float = 30.0) -> None:
    """Block until the Flask server's socket is accepting connections, so
    the webview doesn't navigate to it before it's ready.

    Bounded by `timeout` and checks server_thread is still alive: an
    unbounded loop here would hang forever with no window and no visible
    error if app.run() dies on bind (e.g. a stale instance still holding
    the port) -- Python's default thread excepthook only prints to
    stderr, invisible on macOS where console=False means no console is
    attached at all.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not server_thread.is_alive():
            raise RuntimeError(
                "Server thread exited before it started listening -- see "
                "the traceback above (or the terminal, if run from one)."
            )
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex((HOST, PORT)) == 0:
                return
        time.sleep(0.05)
    raise RuntimeError(f"Server did not start within {timeout}s on {HOST}:{PORT}")


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
                rgba = img.convert("RGBA")
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(rgba, mask=rgba.split()[-1])
                img = background
            else:
                img = img.convert("RGB")
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=85)
        response.set_data(buffer.getvalue())
        response.headers["Content-Type"] = "image/jpeg"
        if "ETag" in response.headers:
            etag = response.headers["ETag"].strip('"')
            response.headers["ETag"] = f'"{etag}-jpeg"'
        return response


def ensure_setup(app) -> None:
    """Idempotently ensure the admin user and tree exist.

    Called on *every* launch, not gated behind a "first run" flag: a run
    that crashes partway through this exact function (disk full, or a
    startup bug like the since-fixed locale.textdomain crash hitting
    before this even got a chance to run) can leave users.sqlite created
    but no admin user yet, or an admin user but no tree yet. Gating this
    behind a boolean computed from one file's existence made every later
    launch wrongly conclude setup had already finished and skip the rest
    forever, with no way to recover short of deleting the whole data
    directory by hand. Each step here is safe to repeat instead:
    user_db.create_all() is a no-op once the tables exist; add_user()
    raises ValueError("User already exists") if it does, caught below;
    WebDbManager's create_if_missing just opens an existing tree by that
    name rather than recreating it.
    """
    from gramps_webapi.auth import add_user, user_db
    from gramps_webapi.auth.const import ROLE_OWNER
    from gramps_webapi.dbmanager import WebDbManager

    with app.app_context():
        user_db.create_all()
        try:
            add_user(
                ADMIN_USER,
                ADMIN_PASSWORD,
                fullname="Admin",
                role=ROLE_OWNER,
                tree=None,
            )
        except ValueError as exc:
            if "already exists" not in str(exc):
                raise
        db_manager = WebDbManager(name=TREE_NAME, create_if_missing=True)
        dbstate = db_manager.get_db(readonly=False)
        dbstate.db.close()


def main() -> None:
    # Used only to word the console message below -- ensure_setup() itself
    # always runs and is safe to repeat, see its own docstring.
    first_run = not os.path.isfile(data_path("users.sqlite"))
    ensure_gramps_dirs()
    config = build_config()

    from gramps_webapi.app import create_app

    app = create_app(config=config, config_from_env=False)
    install_avif_transcoder(app)

    print(
        f"{'First run -- setting up' if first_run else 'Checking'} "
        f"tree in {data_path()} ..."
    )
    ensure_setup(app)

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
    wait_for_server(server_thread)
    print(f"Gramps Connect Desktop running at http://{HOST}:{PORT}")
    print(f"Log in as {ADMIN_USER} / {ADMIN_PASSWORD}")

    if sys.platform.startswith("linux"):
        # Linux's only pywebview backend here is GTK/WebKitGTK, which lags
        # upstream WebKit/Chromium enough to have already produced two
        # confirmed bugs (PointerEvents never dispatched, breaking
        # terra-draw's drag; ALLOW_DOWNLOADS's decision.download() called
        # with nothing listening, silently dropping report/export
        # downloads) plus an unverified one (ES module Worker support,
        # needed by the Pyodide add-on PoC). Rather than chase WebKitGTK
        # compatibility issue by issue, Linux always opens in the tester's
        # own actual browser instead of a native window -- whatever they
        # already have there is a real, currently-maintained engine, the
        # same tradeoff the except branch below already falls back to when
        # no native backend is found at all.
        print("Linux: opening in your default browser instead of a native window ...")
        webbrowser.open(f"http://{HOST}:{PORT}")
        print("Press Control+C to quit")
        server_thread.join()
        return

    # Only macOS (WKWebView) and Windows (WebView2) reach here now -- Linux
    # returned above. pywebview defaults ALLOW_DOWNLOADS to False, which on
    # the GTK backend used to mean it never even connected WebKit's
    # download-started signal -- clicking a report/export "Download" link
    # still got marked for download internally (on_navigation's
    # decide-policy handler calls decision.download() regardless), but
    # nothing was listening for it, so it silently vanished with no error,
    # dialog, or file. Left enabled here too since it's harmless on the
    # remaining backends (each just wires up its own native save dialog).
    webview.settings["ALLOW_DOWNLOADS"] = True

    webview.create_window(APP_NAME, f"http://{HOST}:{PORT}")
    try:
        # webview.start() resolves the platform backend (WKWebView on
        # macOS, WebView2 on Windows) before showing anything -- it raises
        # WebViewException synchronously if none is found, so this is a
        # safe point to fall back rather than a partial/failed launch.
        #
        # private_mode=False: pywebview defaults to private_mode=True, which
        # (at least on the GTK backend this was found against) explicitly
        # disables local storage/IndexedDB -- not flaky, just off. That
        # breaks anything using localStorage with no defensive try/catch
        # (confirmed live, pre-dating the Linux-goes-to-a-browser branch
        # above: browserNotifications.ts's notifyBrowser(), fired on
        # report/job completion, threw "Can't find variable: localStorage"
        # since the API isn't merely empty but doesn't exist as a global at
        # all), and silently no-ops column-width/search-state/map-viewport
        # persistence besides. This is a single-user local app that already
        # persists real data to disk (GRAMPSHOME under DATA_DIR) -- there's
        # no incognito-style privacy need here, so private browsing was
        # actively working against the app's own design. storage_path keeps
        # the resulting profile under DATA_DIR too, consistent with "delete
        # this folder to reset" covering everything, not just the tree.
        webview.start(private_mode=False, storage_path=data_path("webkit-storage"))
    except Exception as exc:
        # webview.WebViewException covers "no backend found at all", but a
        # host whose native bindings import fine yet fail at actual use --
        # e.g. an ABI/library-version mismatch -- can surface as some other
        # exception type from deep inside pywebview's platform backend.
        # Anything here means no working native window either way, so fall
        # back the same way rather than crashing.
        print(f"Native webview backend unavailable ({exc}) -- opening in your browser instead.")
        webbrowser.open(f"http://{HOST}:{PORT}")
        print("Press Control+C to quit")
        server_thread.join()


if __name__ == "__main__":
    main()
