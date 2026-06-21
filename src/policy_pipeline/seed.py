"""Seed prompt templates and model configurations for extraction runs."""

from __future__ import annotations

import argparse
import os
import sys

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from policy_pipeline.config import Settings, get_settings
from policy_pipeline.database import _engine_for_url
from policy_pipeline.extraction_registry import (
    RegistryRecordInUseError,
    save_model_configuration,
    save_prompt_template,
)

RULE_EXTRACTION_PROMPT_TEMPLATE_ID = "rule-extraction"
RULE_EXTRACTION_PROMPT_TEMPLATE_VERSION = "v2"

OPENAI_MODEL_CONFIGURATION_ID = "openai-primary"
OPENAI_MODEL_CONFIGURATION_VERSION = "v1"

FAKE_MODEL_CONFIGURATION_ID = "fake-openai"
FAKE_MODEL_CONFIGURATION_VERSION = "v1"


def rule_extraction_prompt_template() -> str:
    return """You extract atomic candidate Rules from the Policy Document text supplied by the user.

Return a single JSON object with this shape:
{
  "candidate_rules": [
    {
      "statement": "<clear, standalone rule statement>",
      "enforceability_class": "enforceable" | "guidance" | "subjective",
      "scope": {
        "country": "<optional>",
        "expense_category": "<optional>",
        "travel_type": "<optional>",
        "employee_group": "<optional>",
        "effective_start_date": "<optional ISO date>",
        "effective_end_date": "<optional ISO date>"
      },
      "citation_quote": "<verbatim quote from the document that supports the rule>",
      "condition": {
        "field": "<machine-checkable field path>",
        "operator": "<, <=, >, >=, =, or ==>",
        "value": "<threshold as string>"
      },
      "applicability": {
        "aggregation_period": (
          "per_transaction"
          | "per_day"
          | "per_trip"
          | "per_night"
          | "per_attendee"
        ),
        "unit": "<e.g. money, count, miles>",
        "currency": "<optional 3-letter ISO code>",
        "limit_basis": "<optional, e.g. per employee>"
      },
      "exceptions": [
        {
          "description": "<optional exception text>",
          "required_evidence": ["<optional evidence type>"]
        }
      ],
      "extraction_confidence": <optional number from 0.0 to 1.0>
    }
  ]
}

Rules:
- Emit one candidate rule per distinct policy requirement. Prefer atomic rules over
  compound sentences.
- Use enforceability_class "enforceable" only when the rule can be checked automatically.
- Use "guidance" or "subjective" for recommendations, best practices, or judgment-based rules.
- Do not include condition on guidance or subjective rules.
- For quantitative enforceable rules (amounts, counts, limits), include condition and
  applicability when present in the source text.
- citation_quote must be copied exactly from the supplied document text so it can be
  anchored back to the source.
- scope must always be a JSON object. Use {} when no scope dimensions apply. Never set
  scope to null.
- Use null or omit optional scalar fields (including individual scope fields) when the
  document does not specify them.
- Return only valid JSON. Do not wrap the JSON in markdown fences."""


def openai_model_configuration(*, model: str) -> dict[str, object]:
    return {
        "model_configuration_id": OPENAI_MODEL_CONFIGURATION_ID,
        "version": OPENAI_MODEL_CONFIGURATION_VERSION,
        "model": model,
        "endpoint": "https://api.openai.com/v1",
        "settings": {
            "temperature": 0,
            "max_output_tokens": 8000,
        },
    }


def fake_model_configuration() -> dict[str, object]:
    return {
        "model_configuration_id": FAKE_MODEL_CONFIGURATION_ID,
        "version": FAKE_MODEL_CONFIGURATION_VERSION,
        "model": "fake-gpt",
        "endpoint": "https://fake-openai.local/v1",
        "settings": {
            "fake_structured_outputs": [
                {
                    "candidate_rules": [
                        {
                            "statement": "Meals are capped at $75 per day.",
                            "enforceability_class": "enforceable",
                            "scope": {"expense_category": "meals"},
                            "citation_quote": "Meals are capped at $75 per day.",
                            "condition": {
                                "field": "meal.amount",
                                "operator": "<=",
                                "value": "75",
                            },
                            "applicability": {
                                "aggregation_period": "per_day",
                                "unit": "money",
                                "currency": "USD",
                            },
                        }
                    ]
                }
            ],
            "network_access": "private",
        },
    }


def seed_extraction_registry(
    session: Session,
    *,
    openai_model: str,
    include_fake: bool,
) -> None:
    save_prompt_template(
        session,
        prompt_template_id=RULE_EXTRACTION_PROMPT_TEMPLATE_ID,
        version=RULE_EXTRACTION_PROMPT_TEMPLATE_VERSION,
        template=rule_extraction_prompt_template(),
        description=(
            "Extract atomic candidate Rules with citation anchors and structured fields. "
            "Requires scope as an object (use {} when unspecified)."
        ),
        commit=False,
    )

    openai_config = openai_model_configuration(model=openai_model)
    save_model_configuration(
        session,
        model_configuration_id=str(openai_config["model_configuration_id"]),
        version=str(openai_config["version"]),
        model=str(openai_config["model"]),
        endpoint=str(openai_config["endpoint"]),
        settings=dict(openai_config["settings"]),  # type: ignore[arg-type]
        commit=False,
    )

    if include_fake:
        fake_config = fake_model_configuration()
        save_model_configuration(
            session,
            model_configuration_id=str(fake_config["model_configuration_id"]),
            version=str(fake_config["version"]),
            model=str(fake_config["model"]),
            endpoint=str(fake_config["endpoint"]),
            settings=dict(fake_config["settings"]),  # type: ignore[arg-type]
            commit=False,
        )

    session.commit()


def _print_runtime_warnings(settings: Settings) -> None:
    if not settings.llm_api_key:
        print(
            "Warning: POLICY_PIPELINE_LLM_API_KEY is not set. "
            "OpenAI extraction runs will fail authentication.",
            file=sys.stderr,
        )
    if not settings.llm_hosted_endpoints_enabled:
        print(
            "Warning: POLICY_PIPELINE_LLM_HOSTED_ENDPOINTS_ENABLED is false. "
            "Calls to api.openai.com will be rejected until this is true.",
            file=sys.stderr,
        )


def _seed_summary(*, openai_model: str, include_fake: bool) -> None:
    print("Seeded extraction registry records:")
    print(
        f"  prompt template: {RULE_EXTRACTION_PROMPT_TEMPLATE_ID}@"
        f"{RULE_EXTRACTION_PROMPT_TEMPLATE_VERSION}"
    )
    print(
        f"  model configuration: {OPENAI_MODEL_CONFIGURATION_ID}@"
        f"{OPENAI_MODEL_CONFIGURATION_VERSION} (model={openai_model})"
    )
    if include_fake:
        print(
            f"  model configuration: {FAKE_MODEL_CONFIGURATION_ID}@"
            f"{FAKE_MODEL_CONFIGURATION_VERSION} (deterministic fake outputs)"
        )
    print()
    print("Use these IDs when creating extraction runs, for example:")
    print(
        "  prompt_template_id=rule-extraction, prompt_template_version=v1,"
        " model_configuration_id=openai-primary, model_configuration_version=v1"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed prompt templates and model configurations for extraction runs.",
    )
    parser.add_argument(
        "--openai-model",
        default=os.environ.get("POLICY_PIPELINE_SEED_OPENAI_MODEL", "gpt-4o-mini"),
        help="OpenAI model name for the openai-primary configuration (default: gpt-4o-mini).",
    )
    parser.add_argument(
        "--with-fake",
        action="store_true",
        help="Also seed fake-openai@v1 for deterministic local runs without network access.",
    )
    args = parser.parse_args()

    settings = get_settings()
    _print_runtime_warnings(settings)

    session_factory = sessionmaker(
        bind=_engine_for_url(settings.database_url),
        autoflush=False,
        expire_on_commit=False,
    )

    try:
        with session_factory() as session:
            seed_extraction_registry(
                session,
                openai_model=args.openai_model,
                include_fake=args.with_fake,
            )
    except RegistryRecordInUseError as exc:
        print(f"Seed failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except sa.exc.OperationalError as exc:
        print(
            "Seed failed: could not connect to the database. "
            "Run migrations first (`alembic upgrade head`).",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc

    _seed_summary(openai_model=args.openai_model, include_fake=args.with_fake)
