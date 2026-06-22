from __future__ import annotations

from datetime import UTC

from policy_pipeline.compliance_evaluation_runs.models import ComplianceEvaluationRun
from policy_pipeline.compliance_evaluation_runs.records import ComplianceEvaluationRunRecord


def compliance_evaluation_run_from_record(
    record: ComplianceEvaluationRunRecord,
) -> ComplianceEvaluationRun:
    executed_at = record.executed_at
    if executed_at.tzinfo is None:
        executed_at = executed_at.replace(tzinfo=UTC)
    else:
        executed_at = executed_at.astimezone(UTC)
    compliance_run = ComplianceEvaluationRun.model_validate(record.payload)
    return compliance_run.model_copy(update={"executed_at": executed_at})
