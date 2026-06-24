from __future__ import annotations

from datetime import UTC, datetime

from policy_pipeline.compliance_evaluation_runs.records import ComplianceEvaluationRunRecord
from policy_pipeline.compliance_evaluation_runs.store import compliance_evaluation_run_from_record


def test_compliance_evaluation_run_from_record_accepts_legacy_summary_counts() -> None:
    record = ComplianceEvaluationRunRecord(
        compliance_evaluation_run_id="compliance-run-legacy",
        expense_report_id="expense-report-legacy",
        compiled_rule_set_id="compiled-rule-set-legacy",
        policy_version_id="policy-v1",
        executed_by="admin-user",
        executed_at=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        payload={
            "compliance_evaluation_run_id": "compliance-run-legacy",
            "expense_report_id": "expense-report-legacy",
            "compiled_rule_set_id": "compiled-rule-set-legacy",
            "policy_version_id": "policy-v1",
            "executed_by": "admin-user",
            "executed_at": "2026-06-01T12:00:00Z",
            "summary": {
                "total_count": 100,
                "pass_count": 0,
                "violation_count": 100,
            },
            "row_outcomes": [],
        },
    )

    compliance_run = compliance_evaluation_run_from_record(record)

    assert compliance_run.summary.needs_review_count == 0
    assert compliance_run.summary.missing_evidence_count == 0
