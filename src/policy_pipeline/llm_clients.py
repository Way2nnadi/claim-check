from __future__ import annotations

import ipaddress
import json
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from policy_pipeline.config import Settings
from policy_pipeline.extraction_registry import ModelConfiguration, PromptTemplate

_RESERVED_SETTINGS = {
    "api_style",
    "fake_structured_outputs",
    "max_validation_attempts",
    "network_access",
}


class HostedEndpointDisabledError(Exception):
    def __init__(self, endpoint: str) -> None:
        super().__init__(endpoint)
        self.endpoint = endpoint


class CandidateRuleExtractionLLMClient(Protocol):
    def extract_candidate_rules(
        self,
        *,
        prompt_template: PromptTemplate,
        model_configuration: ModelConfiguration,
        document_text: str,
        attempt: int,
    ) -> Any: ...


class FakeOpenAICompatibleAdapter:
    def __init__(self, *, responses: list[Any]) -> None:
        self._responses = list(responses)

    def extract_candidate_rules(
        self,
        *,
        prompt_template: PromptTemplate,
        model_configuration: ModelConfiguration,
        document_text: str,
        attempt: int,
    ) -> Any:
        del prompt_template
        del model_configuration
        del document_text

        if not self._responses:
            return {"candidate_rules": []}
        index = min(attempt - 1, len(self._responses) - 1)
        return self._responses[index]


class OpenAICompatibleLLMClient:
    def __init__(
        self,
        *,
        api_key: str | None,
        timeout_seconds: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds
        self._transport = transport

    def extract_candidate_rules(
        self,
        *,
        prompt_template: PromptTemplate,
        model_configuration: ModelConfiguration,
        document_text: str,
        attempt: int,
    ) -> Any:
        del attempt

        endpoint = _resolve_endpoint(model_configuration=model_configuration)
        payload = _build_request_payload(
            prompt_template=prompt_template,
            model_configuration=model_configuration,
            document_text=document_text,
        )
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        with httpx.Client(
            timeout=self._timeout_seconds,
            transport=self._transport,
        ) as client:
            response = client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()

        return _parse_structured_output(response.json())


def build_llm_client(
    *,
    settings: Settings,
    model_configuration: ModelConfiguration,
    transport: httpx.BaseTransport | None = None,
) -> CandidateRuleExtractionLLMClient:
    if _uses_fake_outputs(model_configuration=model_configuration):
        return FakeOpenAICompatibleAdapter(
            responses=_fake_structured_outputs(model_configuration=model_configuration)
        )

    if not settings.llm_hosted_endpoints_enabled and _uses_hosted_endpoint(
        model_configuration=model_configuration
    ):
        raise HostedEndpointDisabledError(model_configuration.endpoint)

    return OpenAICompatibleLLMClient(
        api_key=settings.llm_api_key,
        timeout_seconds=settings.llm_request_timeout_seconds,
        transport=transport,
    )


def _build_request_payload(
    *,
    prompt_template: PromptTemplate,
    model_configuration: ModelConfiguration,
    document_text: str,
) -> dict[str, Any]:
    api_style = _api_style(model_configuration=model_configuration)
    payload: dict[str, Any]
    if api_style == "responses":
        payload = {
            "model": model_configuration.model,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": prompt_template.template}],
                },
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": document_text}],
                },
            ],
        }
    else:
        payload = {
            "model": model_configuration.model,
            "messages": [
                {"role": "system", "content": prompt_template.template},
                {"role": "user", "content": document_text},
            ],
            "response_format": {"type": "json_object"},
        }
    payload.update(_request_options(model_configuration=model_configuration, api_style=api_style))
    return payload


def _request_options(
    *,
    model_configuration: ModelConfiguration,
    api_style: str,
) -> dict[str, Any]:
    options = {
        key: value
        for key, value in model_configuration.settings.items()
        if key not in _RESERVED_SETTINGS
    }
    if api_style == "chat_completions" and "max_output_tokens" in options:
        options["max_tokens"] = options.pop("max_output_tokens")
    if api_style == "responses" and "max_tokens" in options:
        options["max_output_tokens"] = options.pop("max_tokens")
    return options


def _parse_structured_output(response_body: Any) -> Any:
    if isinstance(response_body, dict) and "candidate_rules" in response_body:
        return response_body

    if isinstance(response_body, dict):
        if isinstance(response_body.get("output_text"), str):
            return json.loads(response_body["output_text"])

        choices = response_body.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message", {})
            content = message.get("content")
            if isinstance(content, str):
                return json.loads(content)
            if isinstance(content, list):
                text = "".join(
                    item.get("text", "")
                    for item in content
                    if isinstance(item, dict) and isinstance(item.get("text"), str)
                )
                if text:
                    return json.loads(text)

        output = response_body.get("output")
        if isinstance(output, list):
            text_parts: list[str] = []
            for item in output:
                if not isinstance(item, dict):
                    continue
                for content in item.get("content", []):
                    if (
                        isinstance(content, dict)
                        and content.get("type") in {"output_text", "text"}
                        and isinstance(content.get("text"), str)
                    ):
                        text_parts.append(content["text"])
            if text_parts:
                return json.loads("".join(text_parts))

    raise ValueError("OpenAI-compatible response did not include structured extraction JSON.")


def _resolve_endpoint(*, model_configuration: ModelConfiguration) -> str:
    endpoint = model_configuration.endpoint.rstrip("/")
    if endpoint.endswith("/chat/completions") or endpoint.endswith("/responses"):
        return endpoint

    api_style = _api_style(model_configuration=model_configuration)
    suffix = "/responses" if api_style == "responses" else "/chat/completions"
    return f"{endpoint}{suffix}"


def _api_style(*, model_configuration: ModelConfiguration) -> str:
    configured_style = model_configuration.settings.get("api_style")
    if configured_style in {"chat_completions", "responses"}:
        return configured_style

    endpoint = model_configuration.endpoint.rstrip("/")
    if endpoint.endswith("/responses"):
        return "responses"
    return "chat_completions"


def _uses_fake_outputs(*, model_configuration: ModelConfiguration) -> bool:
    return "fake_structured_outputs" in model_configuration.settings


def _fake_structured_outputs(*, model_configuration: ModelConfiguration) -> list[Any]:
    responses = model_configuration.settings.get("fake_structured_outputs", [])
    if isinstance(responses, list):
        return responses
    return [responses]


def _uses_hosted_endpoint(*, model_configuration: ModelConfiguration) -> bool:
    configured_access = model_configuration.settings.get("network_access")
    if configured_access == "hosted":
        return True
    if configured_access == "private":
        return False

    hostname = urlparse(_resolve_endpoint(model_configuration=model_configuration)).hostname
    if hostname is None:
        return True
    normalized_hostname = hostname.lower()
    if normalized_hostname == "localhost":
        return False
    if normalized_hostname.endswith((".internal", ".local", ".localhost")):
        return False
    if "." not in normalized_hostname:
        return False
    try:
        address = ipaddress.ip_address(normalized_hostname)
    except ValueError:
        return True
    return not (address.is_private or address.is_loopback or address.is_link_local)
