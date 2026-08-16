"""Tests for launcher.py's AVIF-to-JPEG transcoding hook.

Ubuntu's stock WebKitGTK sends "image/avif" in its Accept header but can't
actually decode the bytes it asked for (see install_avif_transcoder's
docstring in launcher.py), so gramps-web-api's AVIF thumbnails render blank
in the standalone app's native window. These tests exercise the
after_request hook directly against a throwaway Flask app and real
AVIF-encoded bytes -- no webview, gramps-web-api, or display required.
"""

import io

import pytest
from flask import Flask, Response
from PIL import Image

from launcher import install_avif_transcoder


def _avif_bytes(mode="RGB", color=(255, 0, 0), size=(8, 8)):
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    img.save(buf, format="AVIF")
    return buf.getvalue()


def _png_bytes():
    img = Image.new("RGB", (4, 4), (0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    install_avif_transcoder(flask_app)

    @flask_app.route("/avif")
    def avif_route():
        return Response(
            _avif_bytes(),
            mimetype="image/avif",
            headers={"ETag": '"abc123"'},
        )

    @flask_app.route("/avif-no-etag")
    def avif_no_etag_route():
        return Response(_avif_bytes(), mimetype="image/avif")

    @flask_app.route("/avif-rgba")
    def avif_rgba_route():
        return Response(
            _avif_bytes(mode="RGBA", color=(0, 255, 0, 128)),
            mimetype="image/avif",
        )

    @flask_app.route("/avif-404")
    def avif_404_route():
        # Bytes here are deliberately not valid AVIF: if the hook ever
        # stopped checking status_code first, decoding this would raise
        # and fail the test instead of silently passing.
        return Response(b"not an image", mimetype="image/avif", status=404)

    @flask_app.route("/png")
    def png_route():
        return Response(_png_bytes(), mimetype="image/png")

    return flask_app


def test_avif_response_transcoded_to_jpeg(app):
    resp = app.test_client().get("/avif")

    assert resp.status_code == 200
    assert resp.mimetype == "image/jpeg"
    img = Image.open(io.BytesIO(resp.data))
    assert img.format == "JPEG"
    assert img.size == (8, 8)


def test_etag_gets_jpeg_suffix(app):
    resp = app.test_client().get("/avif")

    assert resp.headers["ETag"] == '"abc123-jpeg"'


def test_missing_etag_does_not_crash(app):
    resp = app.test_client().get("/avif-no-etag")

    assert resp.status_code == 200
    assert resp.mimetype == "image/jpeg"
    assert "ETag" not in resp.headers


def test_rgba_avif_flattened_to_opaque_rgb(app):
    resp = app.test_client().get("/avif-rgba")

    img = Image.open(io.BytesIO(resp.data))
    assert img.mode == "RGB"
    # JPEG has no alpha channel -- the green pixel's 50%-alpha should have
    # been blended onto the white background the hook composites onto, not
    # silently dropped to black or left fully green.
    r, g, b = img.getpixel((0, 0))
    assert g > r and g > b
    assert r > 64  # some white bled through, i.e. it was actually composited


def test_non_avif_response_is_untouched(app):
    resp = app.test_client().get("/png")

    assert resp.mimetype == "image/png"
    assert resp.data == _png_bytes()


def test_non_200_avif_response_is_untouched(app):
    resp = app.test_client().get("/avif-404")

    assert resp.status_code == 404
    assert resp.mimetype == "image/avif"
    assert resp.data == b"not an image"
