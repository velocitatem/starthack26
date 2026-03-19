from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FASTAPI_DIR = ROOT / "apps" / "backend" / "fastapi"

for path in (str(ROOT), str(FASTAPI_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from shacklib import backend_state, codex_agent  # noqa: E402
from shacklib.diagnosis_engine import build_status_payload  # noqa: E402
from shacklib.mock_facility import build_seed_state  # noqa: E402


def _reset_memory_state(monkeypatch, state: dict) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(backend_state, "_SCHEMA_READY", False)
    monkeypatch.setattr(backend_state, "_MEMORY_STATE", state)


def test_codex_agent_falls_back_without_openai_key(monkeypatch):
    _reset_memory_state(monkeypatch, build_seed_state())
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = codex_agent.run_codex_agent_chat(
        {
            "messages": [{"role": "user", "content": "Give me a system overview"}],
            "actor": "test-user",
        }
    )

    assert response["usedFallback"] is True
    assert response["toolEvents"][0]["name"] == "get_system_overview"
    assert "active faults" in response["reply"].lower()


def test_codex_agent_requires_and_applies_pending_approval(monkeypatch):
    _reset_memory_state(monkeypatch, build_seed_state())

    def _fake_openai_request(_input_payload):
        return {
            "model": "gpt-5.4",
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call_test_1",
                    "name": "resolve_fault",
                    "arguments": '{"faultId":"fault-003","note":"approved during test"}',
                }
            ],
        }

    monkeypatch.setattr(codex_agent, "_openai_request", _fake_openai_request)

    initial_status = build_status_payload(backend_state.read_state())
    initial_faults = initial_status["derived"]["buildingStats"]["activeFaults"]

    first = codex_agent.run_codex_agent_chat(
        {
            "messages": [
                {"role": "user", "content": "Resolve the highest priority fault"}
            ],
            "actor": "test-user",
        }
    )

    pending = first["pendingAction"]
    assert pending is not None
    assert pending["name"] == "resolve_fault"
    assert first["toolEvents"][0]["outcome"] == "pending_approval"

    second = codex_agent.run_codex_agent_chat(
        {
            "messages": [],
            "actor": "test-user",
            "pendingActionId": pending["id"],
            "pendingActionDecision": "approve",
        }
    )

    assert second["toolEvents"][0]["outcome"] == "executed"

    final_status = build_status_payload(backend_state.read_state())
    final_faults = final_status["derived"]["buildingStats"]["activeFaults"]
    assert final_faults == initial_faults - 1


def test_system_prompt_includes_uploaded_document_context_with_truncation(monkeypatch):
    monkeypatch.setattr(
        codex_agent,
        "get_all_building_document_texts",
        lambda: [
            {
                "filename": "layout.md",
                "content_text": "Mechanical room above the kitchen.\n" + ("A" * 20_000),
            }
        ],
    )

    prompt = codex_agent._system_prompt()

    assert "Building document context:" in prompt
    assert "--- layout.md ---" in prompt
    assert "[truncated]" in prompt
    assert len(prompt) < 17_000
