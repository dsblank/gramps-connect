"""Tests for launcher.migrate_to_multi_tree(): converting an install made
in single-tree mode (admin = Owner with no tree, media straight in media/)
to multi-tree mode, once, on its next launch."""

import os

import pytest
from flask import Flask

import launcher

TREE = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def env(tmp_path, monkeypatch):
    from gramps_webapi.auth import User, user_db
    from gramps_webapi.auth.const import ROLE_ADMIN, ROLE_MEMBER, ROLE_OWNER

    monkeypatch.setattr(launcher, "data_path", lambda *p: os.path.join(tmp_path, *p))
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{tmp_path / 'users.sqlite'}"
    user_db.init_app(app)
    with app.app_context():
        user_db.create_all()
        import uuid

        for name, role, tree in [
            ("admin", ROLE_OWNER, None),
            ("member", ROLE_MEMBER, None),
            ("other-admin", ROLE_ADMIN, None),
            ("elsewhere", ROLE_MEMBER, "another-tree"),
        ]:
            user_db.session.add(User(id=uuid.uuid4(), name=name, pwhash="x", role=role, tree=tree))
        user_db.session.commit()
        media = tmp_path / "media"
        (media / "sub").mkdir(parents=True)
        (media / "photo.png").write_bytes(b"png")
        (media / "sub" / "scan.jpg").write_bytes(b"jpg")
        yield app, tmp_path


def _users():
    from gramps_webapi.auth import User, user_db

    return {u.name: (u.role, u.tree) for u in user_db.session.query(User)}


def test_converts_users_and_media_once(env):
    from gramps_webapi.auth.const import ROLE_ADMIN, ROLE_MEMBER

    app, tmp_path = env
    with app.app_context():
        launcher.migrate_to_multi_tree(TREE)
        assert _users() == {
            "admin": (ROLE_ADMIN, TREE),
            "member": (ROLE_MEMBER, TREE),
            # a site admin may stay treeless, and other trees' users are theirs
            "other-admin": (ROLE_ADMIN, None),
            "elsewhere": (ROLE_MEMBER, "another-tree"),
        }
    tree_media = tmp_path / "media" / TREE
    assert (tree_media / "photo.png").read_bytes() == b"png"
    assert (tree_media / "sub" / "scan.jpg").read_bytes() == b"jpg"
    assert sorted(os.listdir(tmp_path / "media")) == [TREE]
    assert (tmp_path / launcher.TREE_ID_FILE).read_text().strip() == TREE


def test_does_nothing_once_migrated(env):
    app, tmp_path = env
    (tmp_path / launcher.TREE_ID_FILE).write_text(TREE + "\n")
    with app.app_context():
        before = _users()
        launcher.migrate_to_multi_tree(TREE)
        assert _users() == before
    assert (tmp_path / "media" / "photo.png").exists()


def test_finishes_an_interrupted_migration(env):
    app, tmp_path = env
    tree_media = tmp_path / "media" / TREE
    tree_media.mkdir()
    os.rename(tmp_path / "media" / "photo.png", tree_media / "photo.png")
    with app.app_context():
        launcher.migrate_to_multi_tree(TREE)
    assert sorted(os.listdir(tmp_path / "media")) == [TREE]
    assert sorted(os.listdir(tree_media)) == ["photo.png", "sub"]
