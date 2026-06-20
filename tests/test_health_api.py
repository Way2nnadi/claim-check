import httpx
import pytest

from policy_pipeline.main import create_app


@pytest.mark.anyio
async def test_health_endpoint_reports_service_status() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "policy-pipeline",
        "environment": "local",
    }


@pytest.mark.anyio
async def test_config_endpoint_reports_safe_runtime_configuration() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/config")

    assert response.status_code == 200
    assert response.json() == {
        "service": "policy-pipeline",
        "environment": "local",
        "database": {
            "driver": "postgresql+psycopg",
            "host": "localhost",
            "port": 5432,
            "name": "policy_pipeline",
        },
    }
