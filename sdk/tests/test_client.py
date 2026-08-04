import pytest
import responses

from gramps_connect_sdk.exceptions import (
    AuthenticationError,
    NotFoundError,
    ValidationError,
)

from .conftest import BASE_URL


@responses.activate
def test_get_sends_bearer_auth_header(client):
    responses.add(
        responses.GET,
        f"{BASE_URL}/api/people/abc123",
        json={"handle": "abc123", "gramps_id": "I0001"},
        status=200,
    )

    result = client.get("/people/abc123")

    assert result == {"handle": "abc123", "gramps_id": "I0001"}
    sent = responses.calls[0].request
    assert sent.headers["Authorization"] == "Bearer test-api-key"


@responses.activate
def test_base_url_and_api_prefix_are_joined_correctly(client):
    responses.add(responses.GET, f"{BASE_URL}/api/people/", json=[], status=200)

    client.get("/people/")

    assert responses.calls[0].request.url == f"{BASE_URL}/api/people/"


@responses.activate
def test_query_params_are_forwarded(client):
    responses.add(responses.GET, f"{BASE_URL}/api/people/", json=[], status=200)

    client.get("/people/", params={"page": 2, "pagesize": 10})

    sent_url = responses.calls[0].request.url
    assert "page=2" in sent_url
    assert "pagesize=10" in sent_url


@responses.activate
def test_401_raises_authentication_error(client):
    responses.add(
        responses.GET,
        f"{BASE_URL}/api/people/",
        json={"message": "Missing or invalid API key"},
        status=401,
    )

    with pytest.raises(AuthenticationError) as exc_info:
        client.get("/people/")

    assert exc_info.value.status_code == 401
    assert "Missing or invalid API key" in str(exc_info.value)


@responses.activate
def test_404_raises_not_found_error(client):
    responses.add(
        responses.GET,
        f"{BASE_URL}/api/people/nope",
        json={"message": "Not Found"},
        status=404,
    )

    with pytest.raises(NotFoundError):
        client.get("/people/nope")


@responses.activate
def test_422_raises_validation_error(client):
    responses.add(
        responses.POST,
        f"{BASE_URL}/api/people/",
        json={"message": "Invalid object"},
        status=422,
    )

    with pytest.raises(ValidationError):
        client.post("/people/", json={})


@responses.activate
def test_empty_response_body_returns_none(client):
    responses.add(responses.DELETE, f"{BASE_URL}/api/people/abc123", status=200)

    result = client.delete("/people/abc123")

    assert result is None


def test_missing_base_url_raises():
    from gramps_connect_sdk import Client

    with pytest.raises(ValueError):
        Client(base_url="", api_key="key")


def test_missing_api_key_raises():
    from gramps_connect_sdk import Client

    with pytest.raises(ValueError):
        Client(base_url=BASE_URL, api_key="")
