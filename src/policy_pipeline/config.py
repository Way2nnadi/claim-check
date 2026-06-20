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
        for identity in self.local_auth_identities:
            if identity.token == token:
                return identity
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
