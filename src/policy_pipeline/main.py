from fastapi import FastAPI

from policy_pipeline.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.service_name)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": settings.service_name,
            "environment": settings.environment,
        }

    @app.get("/config")
    def config_smoke() -> dict[str, str | dict[str, str]]:
        return {
            "service": settings.service_name,
            "environment": settings.environment,
            "database": {
                "driver": settings.database.driver,
            },
        }

    return app


app = create_app()
