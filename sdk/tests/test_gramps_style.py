import sys

import pytest
import responses

from .conftest import BASE_URL


def _gramps_available() -> bool:
    try:
        import gramps.gen.lib.json_utils  # noqa: F401
    except ImportError:
        return False
    return True


# gramps.gen.lib.json_utils needs the *optional* `gramps` dependency, which
# itself needs system GTK/girepository libs to install (see
# gramps_style.py's module docstring). Tests that need real gramps objects
# are individually skipped when it's not importable in this environment,
# same as any real SDK user without that extra installed -- but plenty of
# this module's behavior (header-only counts, the "not installed" error
# path) doesn't touch gramps at all and always runs.
needs_gramps = pytest.mark.skipif(
    not _gramps_available(), reason="optional 'gramps' dependency not installed"
)


def _person_data(handle="abc123", gramps_id="I0001"):
    from gramps.gen.lib import Person
    from gramps.gen.lib.json_utils import object_to_dict

    person = Person()
    person.set_handle(handle)
    person.set_gramps_id(gramps_id)
    return object_to_dict(person)


@needs_gramps
@responses.activate
def test_get_person_returns_a_real_gramps_object(client):
    from gramps.gen.lib import Person

    responses.add(
        responses.GET, f"{BASE_URL}/api/people/abc123", json=_person_data()
    )

    person = client.get_person("abc123")

    assert isinstance(person, Person)
    assert person.get_handle() == "abc123"
    assert person.get_gramps_id() == "I0001"


@needs_gramps
@responses.activate
def test_get_person_from_gramps_id_uses_the_collection_endpoint(client):
    responses.add(responses.GET, f"{BASE_URL}/api/people/", json=[_person_data()])

    person = client.get_person_from_gramps_id("I0001")

    sent_url = responses.calls[0].request.url
    assert "gramps_id=I0001" in sent_url
    assert person.get_gramps_id() == "I0001"


@needs_gramps
@responses.activate
def test_iter_people_yields_real_objects(client):
    from gramps.gen.lib import Person

    responses.add(
        responses.GET,
        f"{BASE_URL}/api/people/",
        json=[_person_data("a"), _person_data("b", "I0002")],
    )

    people = list(client.iter_people())

    assert [p.get_handle() for p in people] == ["a", "b"]
    assert all(isinstance(p, Person) for p in people)


@responses.activate
def test_get_default_person_returns_none_when_unset(client):
    responses.add(
        responses.GET, f"{BASE_URL}/api/metadata/", json={"default_person": None}
    )

    assert client.get_default_person() is None


@needs_gramps
@responses.activate
def test_get_default_person_resolves_the_handle(client):
    responses.add(
        responses.GET,
        f"{BASE_URL}/api/metadata/",
        json={"default_person": "abc123"},
    )
    responses.add(responses.GET, f"{BASE_URL}/api/people/abc123", json=_person_data())

    person = client.get_default_person()

    assert person.get_handle() == "abc123"


@needs_gramps
@responses.activate
def test_create_accepts_a_real_gramps_object(client):
    from gramps.gen.lib import Person

    responses.add(responses.POST, f"{BASE_URL}/api/people/", json=_person_data())

    person = Person()
    person.set_handle("abc123")
    person.set_gramps_id("I0001")
    client.people.create(person)

    sent_body = responses.calls[0].request.body
    assert b'"handle":"abc123"' in sent_body or b'"handle": "abc123"' in sent_body


@needs_gramps
def test_create_rejects_an_unrelated_object_type(client):
    with pytest.raises(TypeError):
        client.people.create(object())


@responses.activate
def test_get_number_of_people_reads_total_count_header(client):
    responses.add(
        responses.GET,
        f"{BASE_URL}/api/people/",
        json=[{"handle": "abc123"}],
        headers={"X-Total-Count": "42"},
    )

    assert client.get_number_of_people() == 42

    sent_url = responses.calls[0].request.url
    assert "page=1" in sent_url
    assert "pagesize=1" in sent_url


def test_gramps_style_method_missing_gramps_raises_helpful_error(client, monkeypatch):
    # Simulate the common real-world case (gramps installed but PyGObject
    # missing/unbuildable) regardless of what's actually importable in this
    # test environment.
    monkeypatch.setitem(sys.modules, "gramps.gen.lib.json_utils", None)

    with pytest.raises(ImportError, match="gramps-objects"):
        client.get_person("abc123")
