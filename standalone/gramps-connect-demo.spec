# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the standalone Gramps Connect demo.

Gramps discovers its plugins (docgen, importers/exporters, quick reports,
...) by walking gramps/plugins/*.gpr.py on disk at runtime and loading each
one via a direct file-path spec (gramps/gen/plug/_manager.py) -- not through
a normal dotted import that PyInstaller's static analysis would ever see.
So the whole gramps/plugins tree (and gramps' data/, images/ resource
files) has to be bundled as *loose data*, at the exact same relative
layout as the source checkout, rather than left to collect-submodules.
"""

import os
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

import gramps

GRAMPS_PKG_DIR = os.path.dirname(gramps.__file__)
GRAMPS_ROOT = os.path.dirname(GRAMPS_PKG_DIR)
HERE = os.path.abspath(os.path.dirname(os.path.abspath(SPEC)))

datas = [
    (os.path.join(HERE, "frontend"), "frontend"),
    (os.path.join(HERE, "example.gramps"), "."),
    # Whole plugins tree as real files -- see module docstring.
    (os.path.join(GRAMPS_PKG_DIR, "plugins"), "gramps/plugins"),
    # "installed" resource layout expected by
    # gramps.gen.utils.resourcepath.ResourcePath when GRAMPS_RESOURCES
    # points here (see launcher.py) -- authors.xml, images, etc. Bundled
    # straight from the source checkout's data/ dir, not a meson-built
    # build/share/ -- CI runners (and most contributors' checkouts) won't
    # have run the meson build, and this whole build is meant to work with
    # nothing more than the raw git checkouts. Cost: no compiled
    # translations (English only) and no offline docs -- both bundled from
    # build/ output that a bare checkout doesn't have; acceptable for a
    # beta demo.
    (os.path.join(GRAMPS_ROOT, "data"), "gramps-resources/gramps"),
]

# NOT collect_submodules("gramps_webapi") -- that was the actual cause of
# the original 11GB/2.4GB bloat. It force-imports every optional-feature
# submodule to verify importability (chat/llm, semantic search, DNA, ...),
# and modulegraph's static AST parsing then follows *their* imports too --
# e.g. `gramps_webapi.api.llm` alone drags in pydantic_ai's entire provider
# graph (transformers, triton, faiss, onnxruntime, av, duckdb, bokeh,
# googleapiclient, geopandas, llama_cloud, ...). None of those features are
# used by gramps-connect's UI today, and pydantic_ai is even version-broken
# in this env. Plain hiddenimports below + normal graph traversal (now that
# pathex above lets modulegraph actually find gramps_webapi's real source)
# is enough for app.py's genuinely-eager imports of its core CRUD resources.
# Unlike gramps_webapi (see below), plain collect_submodules("gramps") is
# safe and necessary: it's not the source of the earlier bloat (that was
# specifically gramps_webapi.api.llm's pydantic_ai chain), and dropping it
# broke the GEDCOM/CSV/vCard/etc import plugins at runtime ("No module
# named 'gramps.gen.utils.libformatting'") -- those plugin files are loaded
# via a direct file-path importlib spec (see the module docstring above),
# not a normal dotted import modulegraph would follow on its own, so their
# own *dependencies* (like libformatting) need to be force-included too.
hiddenimports = collect_submodules("gramps") + [
    "celery",
    "redis",
    "waitress",
    "flask_smorest",
    "flask_sqlalchemy",
    "flask_jwt_extended",
    "flask_limiter",
    "flask_caching",
    "flask_cors",
    "flask_compress",
    "webargs",
    "marshmallow",
    "orjson",
    "bleach",
    "jsonschema",
    "sqlalchemy",
    "alembic",
    "gramps_ql",
    "object_ql",
    "gramps_object_query_language",
    "gramps_gedcom7",
    "sifts",
    "authlib",
    "unidecode",
    "PIL",
    "requests",
    # Small, no heavy transitive deps -- but structurally can't be cut like
    # the other optional features: resources/ydna.py imports it at true
    # module top-level, and api/__init__.py unconditionally imports that
    # module to register its route, so excluding it would break the whole
    # app's startup (every resource is imported from one file), not just
    # the Y-DNA endpoint.
    "yclade",
]

datas += collect_data_files("gramps_webapi")

# Every one of these is an optional, lazily-imported gramps-web-api feature
# (confirmed by reading each call site) that gramps-connect's UI doesn't use
# today -- AI chat, semantic ("AI") search, face detection in photos,
# S3-backed media storage, OCR, DNA/Y-DNA matching, and PDF/video conversion
# (the last two need their own system binaries -- poppler/ffmpeg -- to work
# at all, so bundling just the Python side wouldn't have made them
# functional anyway). Cutting all of them, plus the huge transitive graphs
# some of them pull in, plus the shared conda env's own large unrelated
# ML/notebook packages that were getting swept in alongside them.
excludes = [
    # Real PyGObject/GTK -- replaced by runtime_hooks/rthook_gi_stub.py's
    # sys.modules injection (see that file for why). Excluding it here is
    # required, not just tidy: PyInstaller has a specialized
    # pre_safe_import_module hook keyed to the literal name "gi" that
    # collects real PyGObject's native typelibs/icon themes regardless of
    # normal pathex/sys.path shadowing -- only an actual exclude stops it
    # from running at all.
    "gi",
    # AI chat assistant + its provider graph
    "gramps_webapi.api.llm",
    "pydantic_ai",
    "mcp",
    "llama_cloud",
    "transformers",
    "triton",
    "onnxruntime",  # also covers face detection, below
    "av",
    "duckdb",
    "googleapiclient",
    "google",
    "httplib2",
    "geopandas",
    "shapely",
    "pyproj",
    "bokeh",
    "plotly",
    "xyzservices",
    "narwhals",
    "xarray",
    "apscheduler",
    "uvicorn",
    "opentelemetry",
    "h5py",
    "fsspec",
    "sphinx",
    "docutils",
    # semantic ("AI") search
    "sentence_transformers",
    "accelerate",
    # face detection in photos
    "cv2",
    "opencv",
    # S3-backed media storage
    "boto3",
    "botocore",
    "s3transfer",
    # OCR on scanned docs (also needs a system tesseract binary regardless)
    "pytesseract",
    # PDF page / video thumbnails (also need poppler/ffmpeg binaries)
    "pdf2image",
    "ffmpeg",
    # unrelated large packages from the shared conda env
    "tensorflow",
    "torch",
    "nltk",
    "numba",
    "datasets",
    "sagemaker",
    "jupyter",
    "jupyterlab",
    "notebook",
    "IPython",
    "matplotlib",
    "scipy",
    "sklearn",
    "streamlit",
    "langchain",
    "langgraph",
    "opik",
    "comet_ml",
    "opik_optimizer",
    "pyarrow",
    "pandas",
]

import gramps_webapi
import gramps_object_query_language

# gramps itself is editable-installed via a plain sys.path-appending .pth
# (PyInstaller's modulegraph resolves it fine), but gramps_webapi and
# gramps_object_query_language use the newer PEP 660 finder-based editable
# install (a MetaPathFinder mapping package name -> real dir, installed via
# a .pth that runs `<finder>.install()`) -- modulegraph does its own
# directory-based lookup across sys.path and can't see through that finder,
# so every gramps_webapi.* hidden import above silently resolved to
# "not found" until their real source directories are added to pathex here.
pathex = [
    os.path.dirname(os.path.dirname(gramps_webapi.__file__)),
    os.path.dirname(os.path.dirname(gramps_object_query_language.__file__)),
]

# PyInstaller's binary-dependency walker paired a mismatched pair here on
# Linux: the conda env's newer libssl.so.3 (needs symbol version
# OPENSSL_3.3.0) alongside the system's older /lib/x86_64-linux-gnu/
# libcrypto.so.3 (3.0.13, doesn't have it) -- runtime ImportError on
# ssl.py. Force both from the same (conda) matched pair explicitly so
# COLLECT can't mix sources. Linux-specific: Windows/macOS Python builds
# link OpenSSL differently (or statically), and sys.base_prefix/lib/*.so
# isn't the right shape on those platforms anyway.
binaries = []
if sys.platform.startswith("linux"):
    _conda_lib = os.path.join(sys.base_prefix, "lib")
    binaries = [
        (os.path.join(_conda_lib, "libssl.so.3"), "."),
        (os.path.join(_conda_lib, "libcrypto.so.3"), "."),
    ]

a = Analysis(
    ["launcher.py"],
    pathex=pathex,
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[os.path.join(HERE, "runtime_hooks", "rthook_gi_stub.py")],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="gramps-connect-demo",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="gramps-connect-demo",
)
