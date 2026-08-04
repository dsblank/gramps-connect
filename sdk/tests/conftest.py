import pytest

from gramps_connect_sdk import Client

BASE_URL = "http://localhost:5003"
API_KEY = "test-api-key"


@pytest.fixture
def client() -> Client:
    return Client(base_url=BASE_URL, api_key=API_KEY)
