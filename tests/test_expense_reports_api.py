from __future__ import annotations

import json
from io import BytesIO

import httpx
import pytest
from sqlalchemy import create_engine

from policy_pipeline.database import Base
from policy_pipeline.main import create_app


def _configure_local_auth(
    monkeypatch: pytest.MonkeyPatch,
    database_url: str,
) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_DATABASE_URL", database_url)
    monkeypatch.setenv(
        "POLICY_PIPELINE_LOCAL_AUTH_IDENTITIES",
        json.dumps(
            [
                {
                    "token": "admin-token",
                    "subject": "admin-user",
                    "roles": ["admin"],
                },
                {
                    "token": "approver-token",
                    "subject": "approver-user",
                    "roles": ["approver"],
                },
                {
                    "token": "viewer-token",
                    "subject": "viewer-user",
                    "roles": ["viewer"],
                },
            ]
        ),
    )


def _csv_upload(filename: str, contents: str) -> dict[str, tuple[str, BytesIO, str]]:
    return {
        "file": (
            filename,
            BytesIO(contents.encode("utf-8")),
            "text/csv",
        )
    }


@pytest.mark.anyio
async def test_admin_imports_expense_report_csv_and_persists_normalized_rows(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    csv_contents = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id\n"
        'emp-001,2026-06-21,meals,42.50,usd,us,domestic,Team dinner,"Alice; Bob",yes,true,trip-7\n'
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/expense-reports",
            headers={"Authorization": "Bearer admin-token"},
            files=_csv_upload("expenses.csv", csv_contents),
        )
        list_response = await client.get(
            "/expense-reports",
            headers={"Authorization": "Bearer viewer-token"},
        )

        assert create_response.status_code == 201
        payload = create_response.json()
        assert payload["imported_by"] == "admin-user"
        assert payload["source_filename"] == "expenses.csv"
        assert payload["row_count"] == 1
        assert len(payload["rows"]) == 1
        assert payload["rows"][0] == {
            "employee_id": "emp-001",
            "expense_date": "2026-06-21",
            "expense_category": "meals",
            "amount": "42.50",
            "currency": "USD",
            "country": "us",
            "travel_type": "domestic",
            "business_purpose": "Team dinner",
            "attendee_list": "Alice; Bob",
            "manager_approval": True,
            "receipt_attached": True,
            "trip_id": "trip-7",
            "submission_days": None,
        }

        assert list_response.status_code == 200
        assert len(list_response.json()["items"]) == 1
        list_item = list_response.json()["items"][0]
        assert list_item["expense_report_id"] == payload["expense_report_id"]
        assert list_item["imported_by"] == "admin-user"
        assert list_item["source_filename"] == "expenses.csv"
        assert list_item["row_count"] == 1
        assert list_item["created_at"] == payload["created_at"]
        assert "rows" not in list_item

        detail_response = await client.get(
            f"/expense-reports/{payload['expense_report_id']}",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert detail_response.status_code == 200
    assert detail_response.json()["rows"] == payload["rows"]


@pytest.mark.anyio
async def test_import_returns_row_level_validation_errors_and_persists_nothing_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    csv_contents = (
        "employee_id,expense_date,expense_category,amount,currency,"
        "manager_approval,receipt_attached\n"
        "emp-001,2026-06-21,meals,,usd,yes,maybe\n"
        "emp-002,not-a-date,lodging,120.00,usd,no,true\n"
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/expense-reports",
            headers={"Authorization": "Bearer admin-token"},
            files=_csv_upload("expenses.csv", csv_contents),
        )
        list_response = await client.get(
            "/expense-reports",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert create_response.status_code == 422
    assert create_response.json() == {
        "detail": "Expense Report import rejected.",
        "file_errors": [],
        "row_errors": [
            {
                "row_number": 2,
                "errors": [
                    "amount is required.",
                    "receipt_attached must be a boolean value (true/false, yes/no, 1/0).",
                ],
            },
            {
                "row_number": 3,
                "errors": [
                    "expense_date must be a valid date in YYYY-MM-DD format.",
                ],
            },
        ],
    }

    assert list_response.status_code == 200
    assert list_response.json() == {"items": []}


@pytest.mark.anyio
async def test_import_rejects_unknown_columns_and_missing_required_columns(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    csv_contents = """employee_id,expense_date,expense_category,amount,merchant_name
emp-001,2026-06-21,meals,42.50,Cafe 99
"""

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/expense-reports",
            headers={"Authorization": "Bearer admin-token"},
            files=_csv_upload("expenses.csv", csv_contents),
        )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Expense Report import rejected.",
        "file_errors": [
            "Missing required columns: currency.",
            "Unknown columns: merchant_name.",
        ],
        "row_errors": [],
    }


@pytest.mark.anyio
async def test_viewer_cannot_import_expense_reports(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    csv_contents = """employee_id,expense_date,expense_category,amount,currency
emp-001,2026-06-21,meals,42.50,USD
"""

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/expense-reports",
            headers={"Authorization": "Bearer viewer-token"},
            files=_csv_upload("expenses.csv", csv_contents),
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "You do not have access to this resource."}


@pytest.mark.anyio
async def test_all_authenticated_roles_can_list_and_open_expense_report_detail(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    csv_contents = """employee_id,expense_date,expense_category,amount,currency
emp-001,2026-06-21,meals,42.50,USD
"""

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/expense-reports",
            headers={"Authorization": "Bearer admin-token"},
            files=_csv_upload("expenses.csv", csv_contents),
        )
        expense_report_id = create_response.json()["expense_report_id"]

        for token in ("admin-token", "approver-token", "viewer-token"):
            list_response = await client.get(
                "/expense-reports",
                headers={"Authorization": f"Bearer {token}"},
            )
            detail_response = await client.get(
                f"/expense-reports/{expense_report_id}",
                headers={"Authorization": f"Bearer {token}"},
            )

            assert list_response.status_code == 200
            assert list_response.json()["items"][0]["expense_report_id"] == expense_report_id
            assert "rows" not in list_response.json()["items"][0]

            assert detail_response.status_code == 200
            assert detail_response.json()["expense_report_id"] == expense_report_id
            assert len(detail_response.json()["rows"]) == 1


@pytest.mark.anyio
async def test_expense_report_detail_returns_not_found_for_unknown_id(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.get(
            "/expense-reports/expense-report-missing",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert response.status_code == 404
    assert response.json() == {"detail": "Expense Report was not found."}
