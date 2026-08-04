import json

import responses

from .conftest import BASE_URL


@responses.activate
def test_get_builds_correct_path(client):
    responses.add(
        responses.GET, f"{BASE_URL}/api/people/abc123", json={"handle": "abc123"}
    )

    result = client.people.get("abc123")

    assert result == {"handle": "abc123"}
    assert responses.calls[0].request.url == f"{BASE_URL}/api/people/abc123"


@responses.activate
def test_list_forwards_params(client):
    responses.add(responses.GET, f"{BASE_URL}/api/families/", json=[])

    client.families.list(gramps_id="F0001")

    assert "gramps_id=F0001" in responses.calls[0].request.url


@responses.activate
def test_query_is_a_post_with_json_body(client):
    responses.add(
        responses.POST,
        f"{BASE_URL}/api/people/query/",
        json={"rows": [], "next_after": None},
    )

    client.people.query(where_expr='surname == "Smith"', limit=100)

    sent = responses.calls[0].request
    assert sent.method == "POST"
    body = json.loads(sent.body)
    assert body == {"where_expr": 'surname == "Smith"', "limit": 100}


@responses.activate
def test_create_posts_to_collection_endpoint(client):
    responses.add(
        responses.POST, f"{BASE_URL}/api/events/", json={"handle": "e1"}, status=201
    )

    client.events.create({"description": "Birth"})

    sent = responses.calls[0].request
    assert sent.url == f"{BASE_URL}/api/events/"
    assert json.loads(sent.body) == {"description": "Birth"}


@responses.activate
def test_update_puts_to_handle_endpoint(client):
    responses.add(responses.PUT, f"{BASE_URL}/api/places/p1", json={"handle": "p1"})

    client.places.update("p1", {"name": "Springfield"})

    sent = responses.calls[0].request
    assert sent.method == "PUT"
    assert sent.url == f"{BASE_URL}/api/places/p1"


@responses.activate
def test_delete_hits_handle_endpoint(client):
    responses.add(responses.DELETE, f"{BASE_URL}/api/tags/t1", status=200)

    client.tags.delete("t1")

    assert responses.calls[0].request.method == "DELETE"
    assert responses.calls[0].request.url == f"{BASE_URL}/api/tags/t1"


@responses.activate
def test_bulk_delete_objects_sends_namespace_and_handles(client):
    responses.add(
        responses.POST, f"{BASE_URL}/api/objects/delete-by-handle/", json=[]
    )

    client.delete_objects("people", ["a", "b"])

    body = json.loads(responses.calls[0].request.body)
    assert body == {"namespace": "people", "handles": ["a", "b"]}


@responses.activate
def test_bulk_create_objects_sends_bare_list(client):
    responses.add(responses.POST, f"{BASE_URL}/api/objects/", json=[])

    client.create_objects([{"_class": "Person"}])

    body = json.loads(responses.calls[0].request.body)
    assert body == [{"_class": "Person"}]
