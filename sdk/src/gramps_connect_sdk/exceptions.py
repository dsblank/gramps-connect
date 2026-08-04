"""Exceptions raised by the gramps-connect SDK."""

from __future__ import annotations

from typing import Any


class GrampsConnectError(Exception):
    """Base class for all errors raised by this SDK."""


class ApiError(GrampsConnectError):
    """The server rejected a request; carries the HTTP status and body."""

    def __init__(self, status_code: int, message: str, payload: Any = None):
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code
        self.payload = payload


class AuthenticationError(ApiError):
    """The API key was missing, invalid, revoked, or lacks permission (401/403)."""


class NotFoundError(ApiError):
    """The requested object does not exist (404)."""


class ValidationError(ApiError):
    """The request body or query arguments were rejected (422)."""
