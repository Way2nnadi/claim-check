from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from policy_pipeline.audit.router import router as audit_router
from policy_pipeline.compliance_evaluation_runs.router import (
    router as compliance_evaluation_runs_router,
)
from policy_pipeline.compliance_review.router import router as compliance_review_router
from policy_pipeline.compiled_rule_sets.router import router as compiled_rule_sets_router
from policy_pipeline.rule_test_cases.router import router as rule_test_cases_router
from policy_pipeline.expense_reports_router import router as expense_reports_router
from policy_pipeline.extraction.router_registry import router as extraction_registry_router
from policy_pipeline.extraction.router_runs import router as extraction_runs_router
from policy_pipeline.policy_documents.router import router as policy_documents_router
from policy_pipeline.policy_versions.router import router as policy_versions_router
from policy_pipeline.reingestion.router import router as reingestion_router
from policy_pipeline.rules.router_candidate import router as candidate_rules_router
from policy_pipeline.rules.router_manual import router as manual_rules_router
from policy_pipeline.shared.config import get_settings
from policy_pipeline.shared.health.router import router as health_router


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.service_name)
    if settings.cors_allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_allowed_origins),
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["Authorization", "Content-Type"],
        )

    app.include_router(health_router)
    app.include_router(policy_documents_router)
    app.include_router(reingestion_router)
    app.include_router(extraction_registry_router)
    app.include_router(extraction_runs_router)
    app.include_router(candidate_rules_router)
    app.include_router(manual_rules_router)
    app.include_router(policy_versions_router)
    app.include_router(compiled_rule_sets_router)
    app.include_router(rule_test_cases_router)
    app.include_router(expense_reports_router)
    app.include_router(compliance_evaluation_runs_router)
    app.include_router(compliance_review_router)
    app.include_router(audit_router)

    return app


app = create_app()
