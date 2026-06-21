from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Protocol

from policy_pipeline.config import get_settings


class ObjectStorageAdapter(Protocol):
    def put_bytes(self, *, key: str, data: bytes, content_type: str) -> None:
        ...

    def get_bytes(self, *, key: str) -> bytes:
        ...


class FilesystemObjectStorageAdapter:
    def __init__(self, root: Path) -> None:
        self._root = root

    def put_bytes(self, *, key: str, data: bytes, content_type: str) -> None:
        del content_type
        object_path = self._root / key
        object_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_bytes(data)

    def get_bytes(self, *, key: str) -> bytes:
        object_path = self._root / key
        return object_path.read_bytes()


@lru_cache
def get_object_storage() -> ObjectStorageAdapter:
    settings = get_settings()
    return FilesystemObjectStorageAdapter(Path(settings.object_storage_root))


def clear_object_storage_cache() -> None:
    get_object_storage.cache_clear()
