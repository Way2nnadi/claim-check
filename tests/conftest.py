import pytest

from policy_pipeline.config import get_settings
from policy_pipeline.database import clear_database_cache


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    get_settings.cache_clear()
    clear_database_cache()
    yield
    get_settings.cache_clear()
    clear_database_cache()
