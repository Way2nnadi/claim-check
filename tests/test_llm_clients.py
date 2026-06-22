from __future__ import annotations

import json

import httpx
import pytest

from policy_pipeline.extraction.llm_clients import (
    HostedEndpointDisabledError,
    OpenAICompatibleLLMClient,
    build_llm_client,
)
from policy_pipeline.extraction.registry import ModelConfiguration, PromptTemplate
from policy_pipeline.shared.config import Settings


def _prompt_template() -> PromptTemplate:
    return PromptTemplate(
        prompt_template_id="rule-extraction",
        version="v1",
        template="Extract candidate Rules from the Policy Document.",
    )


def test_build_llm_client_keeps_fake_adapter_available_for_deterministic_runs() -> None:
    model_configuration = ModelConfiguration(
        model_configuration_id="fake-openai",
        version="v1",
        model="gpt-5-mini",
        endpoint="https://fake-openai.local/v1/chat/completions",
        settings={
            "fake_structured_outputs": [
                {"candidate_rules": [{"statement": "first"}]},
                {"candidate_rules": [{"statement": "second"}]},
            ]
        },
    )

    client = build_llm_client(
        settings=Settings(),
        model_configuration=model_configuration,
    )

    first_response = client.extract_candidate_rules(
        prompt_template=_prompt_template(),
        model_configuration=model_configuration,
        document_text="Meals are capped at $75 per day.",
        attempt=1,
    )
    second_response = client.extract_candidate_rules(
        prompt_template=_prompt_template(),
        model_configuration=model_configuration,
        document_text="Meals are capped at $75 per day.",
        attempt=2,
    )

    assert first_response == {"candidate_rules": [{"statement": "first"}]}
    assert second_response == {"candidate_rules": [{"statement": "second"}]}


def test_openai_compatible_client_uses_configured_endpoint_and_model() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            status_code=200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"candidate_rules": [{"statement": "ok"}]})
                        }
                    }
                ]
            },
        )

    model_configuration = ModelConfiguration(
        model_configuration_id="openai-compatible",
        version="v1",
        model="gpt-5-mini",
        endpoint="https://llm.internal/v1/chat/completions",
        settings={},
    )
    client = OpenAICompatibleLLMClient(
        api_key="test-key",
        transport=httpx.MockTransport(handler),
    )

    response = client.extract_candidate_rules(
        prompt_template=_prompt_template(),
        model_configuration=model_configuration,
        document_text="Meals are capped at $75 per day.",
        attempt=1,
    )

    assert response == {"candidate_rules": [{"statement": "ok"}]}
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "https://llm.internal/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer test-key"

    body = json.loads(request.content)
    assert body["model"] == "gpt-5-mini"
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1]["role"] == "user"


def test_openai_compatible_client_accepts_base_url_configuration() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            status_code=200,
            json={"output_text": json.dumps({"candidate_rules": []})},
        )

    model_configuration = ModelConfiguration(
        model_configuration_id="nim-private",
        version="v1",
        model="meta-llama",
        endpoint="https://llm.internal/v1",
        settings={"api_style": "responses"},
    )
    client = OpenAICompatibleLLMClient(
        api_key=None,
        transport=httpx.MockTransport(handler),
    )

    response = client.extract_candidate_rules(
        prompt_template=_prompt_template(),
        model_configuration=model_configuration,
        document_text="Meals are capped at $75 per day.",
        attempt=1,
    )

    assert response == {"candidate_rules": []}
    assert len(requests) == 1
    assert str(requests[0].url) == "https://llm.internal/v1/responses"


def test_no_outbound_network_mode_rejects_hosted_endpoints() -> None:
    settings = Settings(llm_hosted_endpoints_enabled=False)
    model_configuration = ModelConfiguration(
        model_configuration_id="openai-primary",
        version="v1",
        model="gpt-5-mini",
        endpoint="https://api.openai.com/v1/chat/completions",
        settings={},
    )

    with pytest.raises(HostedEndpointDisabledError):
        build_llm_client(
            settings=settings,
            model_configuration=model_configuration,
        )
