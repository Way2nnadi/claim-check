from __future__ import annotations


def full_rule_scope(**overrides: object) -> dict[str, object]:
    scope = {
        "country": None,
        "expense_category": "meals",
        "travel_type": None,
        "employee_group": None,
        "department": None,
        "role": None,
        "seniority": None,
        "state": None,
        "city": None,
        "region": None,
        "effective_start_date": None,
        "effective_end_date": None,
    }
    scope.update(overrides)
    return scope
