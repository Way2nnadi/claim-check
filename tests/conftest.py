import pytest

from policy_pipeline.shared.config import get_settings
from policy_pipeline.shared.database import clear_database_cache
from policy_pipeline.shared.object_storage import clear_object_storage_cache


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    get_settings.cache_clear()
    clear_database_cache()
    clear_object_storage_cache()
    yield
    get_settings.cache_clear()
    clear_database_cache()
    clear_object_storage_cache()
