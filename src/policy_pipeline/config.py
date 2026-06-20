from functools import lru_cache

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


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

    @property
    def database(self) -> DatabaseSmokeConfig:
        url = make_url(self.database_url)
        return DatabaseSmokeConfig(
            driver=url.drivername,
            host=url.host,
            port=url.port,
            name=url.database,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
