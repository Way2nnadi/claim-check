from functools import lru_cache

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

from policy_pipeline.identity import LocalIdentitySettings


class DatabaseSmokeConfig(BaseModel):
    driver: str
    host: str | None
    port: int | None
    name: str | None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="POLICY_PIPELINE_",
        extra="ignore",
    )

    service_name: str = "policy-pipeline"
    environment: str = "local"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/policy_pipeline"
    object_storage_root: str = ".policy-pipeline/object-storage"
    local_auth_enabled: bool | None = None
    local_auth_identities: tuple[LocalIdentitySettings, ...] = (
        LocalIdentitySettings(
            token="local-admin-token",
            subject="local-admin",
            roles=("admin",),
        ),
        LocalIdentitySettings(
            token="local-approver-token",
            subject="local-approver",
            roles=("approver",),
        ),
        LocalIdentitySettings(
            token="local-viewer-token",
            subject="local-viewer",
            roles=("viewer",),
        ),
    )

    @property
    def database(self) -> DatabaseSmokeConfig:
        url = make_url(self.database_url)
        return DatabaseSmokeConfig(
            driver=url.drivername,
            host=url.host,
            port=url.port,
            name=url.database,
        )

    def local_identity_for_token(self, token: str) -> LocalIdentitySettings | None:
        if not self.is_local_auth_enabled:
            return None
        for identity in self.local_auth_identities:
            if identity.token == token:
                return identity
        return None

    @property
    def is_local_auth_enabled(self) -> bool:
        if self.local_auth_enabled is not None:
            return self.local_auth_enabled
        return self.environment in {"local", "test"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
