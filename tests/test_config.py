from policy_pipeline.config import Settings, get_settings


def test_settings_use_local_defaults() -> None:
    settings = Settings()

    assert settings.environment == "local"
    assert settings.service_name == "policy-pipeline"
    assert settings.database_url == "postgresql+psycopg://postgres:postgres@localhost:5432/policy_pipeline"


def test_settings_can_be_overridden_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_ENVIRONMENT", "test")
    monkeypatch.setenv(
        "POLICY_PIPELINE_DATABASE_URL",
        "postgresql+psycopg://claimcheck:secret@db.internal:5433/claim_check",
    )
    get_settings.cache_clear()

    settings = get_settings()

    assert settings.environment == "test"
    assert settings.database.host == "db.internal"
    assert settings.database.port == 5433
    assert settings.database.name == "claim_check"

    get_settings.cache_clear()
