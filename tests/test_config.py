from policy_pipeline.config import Settings, get_settings


def test_settings_use_local_defaults() -> None:
    settings = Settings()

    assert settings.environment == "local"
    assert settings.service_name == "policy-pipeline"
    assert settings.database_url == "postgresql+psycopg://postgres:postgres@localhost:5432/policy_pipeline"
    assert settings.object_storage_encryption_at_rest_required is True
    assert settings.object_storage_server_side_encryption_algorithm == "AES256"
    assert settings.object_storage_kms_key_id is None
    assert settings.is_local_auth_enabled is True


def test_settings_can_be_overridden_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_ENVIRONMENT", "test")
    monkeypatch.setenv(
        "POLICY_PIPELINE_DATABASE_URL",
        "postgresql+psycopg://claimcheck:secret@db.internal:5433/claim_check",
    )
    monkeypatch.setenv("POLICY_PIPELINE_OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_ALGORITHM", "aws:kms")
    monkeypatch.setenv("POLICY_PIPELINE_OBJECT_STORAGE_KMS_KEY_ID", "kms-key-123")

    settings = get_settings()

    assert settings.environment == "test"
    assert settings.database.host == "db.internal"
    assert settings.database.port == 5433
    assert settings.database.name == "claim_check"
    assert settings.object_storage_server_side_encryption_algorithm == "aws:kms"
    assert settings.object_storage_kms_key_id == "kms-key-123"
    assert settings.is_local_auth_enabled is True


def test_local_auth_is_disabled_outside_local_and_test_by_default(monkeypatch) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_ENVIRONMENT", "production")

    settings = get_settings()

    assert settings.is_local_auth_enabled is False
