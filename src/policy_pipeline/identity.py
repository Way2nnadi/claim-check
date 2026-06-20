from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class Role(StrEnum):
    ADMIN = "admin"
    APPROVER = "approver"
    VIEWER = "viewer"


class LocalIdentitySettings(BaseModel):
    token: str
    subject: str
    roles: tuple[Role, ...]


class AuthenticatedPrincipal(BaseModel):
    subject: str
    roles: tuple[Role, ...]
    auth_backend: str = "local"
