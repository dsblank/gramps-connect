"""Tests for launcher.migrate_user_db(): bringing the standalone build's
users.sqlite up to gramps-web-api's current schema with its own alembic
migrations, including databases that earlier builds created with
create_all() and never versioned.

Runs gramps-web-api's real migration scripts (found via alembic_dir(), i.e.
the checkout gramps_webapi is installed from) against scratch SQLite files.
"""

import logging
import os
import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

import launcher


def _cfg():
    root = launcher.alembic_dir()
    cfg = Config(os.path.join(root, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(root, "alembic_users"))
    return cfg


HEAD = ScriptDirectory.from_config(_cfg()).get_current_head()


def _version(db_file):
    con = sqlite3.connect(db_file)
    try:
        return con.execute("select version_num from alembic_version").fetchone()[0]
    finally:
        con.close()


def _db_at(tmp_path, revision, versioned=True):
    """A users DB at `revision`; unversioned = what a pre-migration build's
    create_all() left: those tables, but no alembic_version row."""
    db_file = str(tmp_path / "users.sqlite")
    launcher._run_alembic(command.upgrade, _cfg(), f"sqlite:///{db_file}", revision)
    if not versioned:
        con = sqlite3.connect(db_file)
        con.execute("drop table alembic_version")
        con.commit()
        con.close()
    return db_file


def _backups(tmp_path):
    return sorted(p.name for p in tmp_path.iterdir() if ".bak-" in p.name)


def test_fresh_install_creates_a_versioned_database(tmp_path):
    db_file = str(tmp_path / "users.sqlite")
    launcher.migrate_user_db(db_file)
    assert _version(db_file) == HEAD
    assert _backups(tmp_path) == []


def test_empty_file_from_a_crashed_first_run_counts_as_fresh(tmp_path):
    db_file = tmp_path / "users.sqlite"
    db_file.write_bytes(b"")
    launcher.migrate_user_db(str(db_file))
    assert _version(str(db_file)) == HEAD


@pytest.mark.parametrize("revision", [rev for rev, _test in launcher._UNVERSIONED_SCHEMAS])
def test_unversioned_database_is_recognised_and_upgraded(tmp_path, revision):
    db_file = _db_at(tmp_path, revision, versioned=False)
    launcher.migrate_user_db(db_file)
    assert _version(db_file) == HEAD
    # labelled tokens now work: the newest migration's column is there
    con = sqlite3.connect(db_file)
    cols = {row[1] for row in con.execute("pragma table_info(access_tokens)")}
    con.close()
    assert {"label", "last_used_at"} <= cols
    # backed up first, unless it was already current and only got stamped
    assert len(_backups(tmp_path)) == (0 if revision == HEAD else 1)


def test_older_versioned_database_is_upgraded_with_a_backup(tmp_path):
    db_file = _db_at(tmp_path, "6d8f3cb50b71")
    launcher.migrate_user_db(db_file)
    assert _version(db_file) == HEAD
    assert len(_backups(tmp_path)) == 1


def test_current_database_is_left_alone(tmp_path):
    db_file = _db_at(tmp_path, "head")
    before = os.path.getmtime(db_file)
    launcher.migrate_user_db(db_file)
    assert _version(db_file) == HEAD
    assert _backups(tmp_path) == []
    assert os.path.getmtime(db_file) == before


def test_unrecognised_unversioned_database_stops_startup(tmp_path):
    db_file = str(tmp_path / "users.sqlite")
    con = sqlite3.connect(db_file)
    con.execute("create table users (id char(32) primary key, name varchar)")
    con.commit()
    con.close()
    with pytest.raises(RuntimeError, match="can't be upgraded safely"):
        launcher.migrate_user_db(db_file)
    assert _backups(tmp_path) == []


def test_migrates_only_the_given_file_whatever_the_environment_says(tmp_path, monkeypatch):
    elsewhere = tmp_path / "elsewhere.sqlite"
    config_file = tmp_path / "other.cfg"
    config_file.write_text(f'USER_DB_URI = "sqlite:///{elsewhere}"\n')
    monkeypatch.setenv("USER_DB_URI", f"sqlite:///{elsewhere}")
    monkeypatch.setenv("GRAMPS_API_CONFIG", str(config_file))
    db_file = str(tmp_path / "users.sqlite")
    launcher.migrate_user_db(db_file)
    assert _version(db_file) == HEAD
    assert not elsewhere.exists()
    # and the caller's environment is put back
    assert os.environ["USER_DB_URI"] == f"sqlite:///{elsewhere}"
    assert os.environ["GRAMPS_API_CONFIG"] == str(config_file)


def test_existing_loggers_keep_working(tmp_path):
    logger = logging.getLogger("gramps_connect_test_logger")
    launcher.migrate_user_db(str(tmp_path / "users.sqlite"))
    assert not logger.disabled
