from __future__ import annotations

import json
import os
from typing import Any
from uuid import uuid4

import requests

from shacklib.backend_state import (
    get_all_building_document_texts,
    read_state,
    update_state,
)
from shacklib.diagnosis_engine import (
    build_node_fault_history_payload,
    build_status_payload,
    resolve_fault,
    utc_now_iso,
)
from shacklib.elevenlabs_agent import (
    ElevenLabsConfigurationError,
    ElevenLabsWebhookPayloadError,
    place_outbound_call,
)
from shacklib.ml_inference_client import MLInferenceError, infer_failure_mode_for_node

OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses"
DEFAULT_AGENT_MODEL = "gpt-5.4"

_AGENT_STORE_KEY = "agent"
_PENDING_ACTIONS_KEY = "pendingActions"
_AUDIT_LOG_KEY = "auditLog"
_AUDIT_LOG_LIMIT = 250
_DOCUMENT_CONTEXT_CHAR_LIMIT = 15_000

_MUTATING_TOOLS = {"resolve_fault", "escalate_fault"}


def _safe_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _agent_model() -> str:
    return os.getenv("AGENT_MODEL", DEFAULT_AGENT_MODEL)


def _max_tool_steps() -> int:
    return _safe_int(os.getenv("AGENT_MAX_TOOL_STEPS", "6"), 6, 1, 12)


def _escalation_phone_number() -> str:
    return str(os.getenv("ESCALATION_PHONE_NUMBER") or "").strip()


def _normalize_actor(raw: Any) -> str:
    text = str(raw or "webapp-operator").strip()
    if not text:
        return "webapp-operator"
    return text[:64]


def _system_prompt() -> str:
    base_prompt = (
        "You are Belimo Ops Copilot for HVAC fault diagnostics. "
        "Use tools whenever you need current platform data. "
        "Never invent IDs, metrics, or fault states. "
        "When the user asks to execute an action, call the matching tool. "
        "Keep answers short and operationally useful.\n\n"
        "IMPORTANT: You have full ability to place phone calls via the escalate_fault tool. "
        "Never say you cannot place calls or send escalations. "
        "When the user asks to escalate or call about a fault or node, you MUST call escalate_fault. "
        "Do not ask for a phone number — it is pre-configured. "
        "If you do not know the faultId, call get_system_overview first to find it, then call escalate_fault. "
        "Do not ask for confirmation. Do not offer alternatives. Just call the tool."
    )
    document_context = _building_document_context()
    if not document_context:
        return base_prompt
    return f"{base_prompt}\n\nBuilding document context:\n{document_context}"


def _building_document_context() -> str:
    documents = get_all_building_document_texts()
    if not documents:
        return ""

    chunks: list[str] = []
    remaining = _DOCUMENT_CONTEXT_CHAR_LIMIT

    for document in documents:
        filename = (
            str(document.get("filename") or "document.txt").strip() or "document.txt"
        )
        content = str(document.get("content_text") or "").strip()
        if not content:
            continue

        section = f"--- {filename} ---\n{content}"
        if len(section) <= remaining:
            chunks.append(section)
            remaining -= len(section)
            if remaining <= 0:
                break
            continue

        if remaining <= len(f"--- {filename} ---\n"):
            break

        trimmed_content_budget = remaining - len(f"--- {filename} ---\n\n[truncated]")
        if trimmed_content_budget <= 0:
            break

        chunks.append(
            f"--- {filename} ---\n{content[:trimmed_content_budget].rstrip()}\n[truncated]"
        )
        break

    return "\n\n".join(chunks)


def _tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": "get_system_overview",
            "description": "Get the current building health snapshot and active faults.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "get_node_details",
            "description": "Get live details and telemetry history for one node/device by id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "nodeId": {
                        "type": "string",
                        "description": "Exact node/device id, for example BEL-VNT-003",
                    }
                },
                "required": ["nodeId"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "get_node_fault_history",
            "description": "Get all historical faults for a node, including resolved and open faults.",
            "parameters": {
                "type": "object",
                "properties": {
                    "nodeId": {
                        "type": "string",
                        "description": "Exact node/device id, for example BEL-VNT-003",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of history entries to return",
                        "minimum": 1,
                        "maximum": 50,
                    },
                },
                "required": ["nodeId"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "resolve_fault",
            "description": "Resolve an open fault by id. This mutates platform state and requires user approval.",
            "parameters": {
                "type": "object",
                "properties": {
                    "faultId": {
                        "type": "string",
                        "description": "Fault id to resolve, for example fault-003",
                    },
                    "resolvedBy": {
                        "type": "string",
                        "description": "Operator identity for audit trail",
                    },
                    "note": {
                        "type": "string",
                        "description": "Optional operator note",
                    },
                },
                "required": ["faultId"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "escalate_fault",
            "description": (
                "Place an outbound voice call to an on-site engineer about an active fault. "
                "Use this tool whenever the user asks to call a phone number about a fault or node. "
                "The platform handles the call. You do not need any external service — just call this tool."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "faultId": {
                        "type": "string",
                        "description": "The fault id to escalate, e.g. fault-003",
                    },
                    "engineerName": {
                        "type": "string",
                        "description": "Name of the engineer being called (optional, defaults to On-Site Engineer)",
                    },
                    "buildingName": {
                        "type": "string",
                        "description": "Building name override (optional, defaults to platform building name)",
                    },
                },
                "required": ["faultId"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "run_node_diagnosis",
            "description": "Run an immediate ML diagnosis for a specific node id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "nodeId": {
                        "type": "string",
                        "description": "Exact node/device id, for example BEL-VNT-003",
                    }
                },
                "required": ["nodeId"],
                "additionalProperties": False,
            },
        },
    ]


def _extract_tool_calls(response_payload: dict[str, Any]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for item in response_payload.get("output", []) or []:
        if item.get("type") != "function_call":
            continue
        calls.append(
            {
                "callId": item.get("call_id") or item.get("id") or "",
                "name": item.get("name") or "",
                "arguments": item.get("arguments") or "{}",
            }
        )
    return [call for call in calls if call["callId"] and call["name"]]


def _extract_output_text(response_payload: dict[str, Any]) -> str:
    direct = response_payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    chunks: list[str] = []
    for item in response_payload.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []) or []:
            content_type = content.get("type")
            if content_type not in {"output_text", "text"}:
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                chunks.append(text.strip())

    return "\n".join(chunks).strip()


def _safe_json_loads(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def _serialize_tool_output(payload: dict[str, Any], max_chars: int = 8000) -> str:
    text = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), default=str)
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 64] + '..."_truncated":true}'


def _ensure_agent_store(
    state: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], list[Any]]:
    agent_store = state.setdefault(_AGENT_STORE_KEY, {})
    if not isinstance(agent_store, dict):
        agent_store = {}
        state[_AGENT_STORE_KEY] = agent_store

    pending_actions = agent_store.setdefault(_PENDING_ACTIONS_KEY, {})
    if not isinstance(pending_actions, dict):
        pending_actions = {}
        agent_store[_PENDING_ACTIONS_KEY] = pending_actions

    audit_log = agent_store.setdefault(_AUDIT_LOG_KEY, [])
    if not isinstance(audit_log, list):
        audit_log = []
        agent_store[_AUDIT_LOG_KEY] = audit_log

    return agent_store, pending_actions, audit_log


def _append_audit_event(state: dict[str, Any], event: dict[str, Any]) -> None:
    _, _, audit_log = _ensure_agent_store(state)
    audit_log.append(event)
    if len(audit_log) > _AUDIT_LOG_LIMIT:
        del audit_log[:-_AUDIT_LOG_LIMIT]


def _create_pending_action(
    name: str, arguments: dict[str, Any], actor: str
) -> dict[str, Any]:
    def _mutator(state: dict[str, Any]) -> dict[str, Any]:
        _, pending_actions, _ = _ensure_agent_store(state)
        action_id = f"action-{uuid4().hex[:10]}"
        pending = {
            "id": action_id,
            "name": name,
            "arguments": arguments,
            "requestedBy": actor,
            "createdAt": utc_now_iso(),
        }
        pending_actions[action_id] = pending
        _append_audit_event(
            state,
            {
                "id": f"audit-{uuid4().hex[:10]}",
                "type": "pending_action_created",
                "name": name,
                "arguments": arguments,
                "actor": actor,
                "createdAt": utc_now_iso(),
            },
        )
        return pending

    return update_state(_mutator)


def _pop_pending_action(action_id: str) -> dict[str, Any] | None:
    def _mutator(state: dict[str, Any]) -> dict[str, Any] | None:
        _, pending_actions, _ = _ensure_agent_store(state)
        value = pending_actions.pop(action_id, None)
        if isinstance(value, dict):
            return value
        return None

    return update_state(_mutator)


def _record_action_event(
    *,
    action_name: str,
    arguments: dict[str, Any],
    actor: str,
    outcome: str,
    details: dict[str, Any] | None = None,
) -> None:
    def _mutator(state: dict[str, Any]) -> None:
        _append_audit_event(
            state,
            {
                "id": f"audit-{uuid4().hex[:10]}",
                "type": "action_execution",
                "name": action_name,
                "arguments": arguments,
                "actor": actor,
                "outcome": outcome,
                "details": details or {},
                "createdAt": utc_now_iso(),
            },
        )

    update_state(_mutator)


def _pending_action_summary(name: str, arguments: dict[str, Any]) -> str:
    if name == "resolve_fault":
        fault_id = str(arguments.get("faultId") or "unknown")
        return f"Resolve fault `{fault_id}`"
    if name == "escalate_fault":
        fault_id = str(arguments.get("faultId") or "unknown")
        to_number = _escalation_phone_number() or "the configured escalation number"
        return f"Call {to_number} about `{fault_id}`"
    return f"Execute `{name}`"


def _tool_get_system_overview() -> dict[str, Any]:
    def _mutator(state: dict[str, Any]) -> dict[str, Any]:
        payload = build_status_payload(state)
        nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}
        faults = state.get("faults") if isinstance(state.get("faults"), dict) else {}

        open_faults: list[dict[str, Any]] = []
        for fault in faults.values():
            if not isinstance(fault, dict) or fault.get("state") != "open":
                continue
            node_id = str(fault.get("nodeId") or "")
            node = nodes.get(node_id) if isinstance(nodes, dict) else None
            open_faults.append(
                {
                    "faultId": fault.get("id"),
                    "nodeId": node_id,
                    "nodeLabel": node.get("label")
                    if isinstance(node, dict)
                    else node_id,
                    "kind": fault.get("kind"),
                    "probability": float(fault.get("probability") or 0.0),
                    "summary": fault.get("summary"),
                    "recommendedAction": fault.get("recommendedAction"),
                    "openedAt": fault.get("openedAt"),
                    "updatedAt": fault.get("updatedAt"),
                }
            )

        open_faults.sort(
            key=lambda item: str(item.get("updatedAt") or item.get("openedAt") or ""),
            reverse=True,
        )

        return {
            "generatedAt": payload.get("generatedAt"),
            "buildingStats": payload.get("derived", {}).get("buildingStats", {}),
            "openFaults": open_faults[:10],
        }

    return update_state(_mutator)


def _tool_get_node_details(node_id: str) -> dict[str, Any]:
    def _mutator(state: dict[str, Any]) -> dict[str, Any]:
        payload = build_status_payload(state)
        raw_nodes = payload.get("nodes", [])
        devices = payload.get("derived", {}).get("devices", [])
        history_by_node = payload.get("historyByNodeId", {})
        state_nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}

        node = next((item for item in raw_nodes if item.get("id") == node_id), None)
        device = next((item for item in devices if item.get("id") == node_id), None)
        state_node = state_nodes.get(node_id) if isinstance(state_nodes, dict) else None

        if node is None and device is None and not isinstance(state_node, dict):
            return {
                "error": "node not found",
                "nodeId": node_id,
            }

        return {
            "nodeId": node_id,
            "node": node,
            "device": device,
            "latestTelemetry": (
                state_node.get("latestTelemetry", {})
                if isinstance(state_node, dict)
                else {}
            ),
            "history": history_by_node.get(node_id, {}),
        }

    return update_state(_mutator)


def _tool_get_node_fault_history(node_id: str, limit: int) -> dict[str, Any]:
    def _mutator(state: dict[str, Any]) -> dict[str, Any]:
        nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}
        if node_id not in nodes:
            return {
                "error": "node not found",
                "nodeId": node_id,
            }

        return build_node_fault_history_payload(state, node_id=node_id, limit=limit)

    return update_state(_mutator)


def _tool_resolve_fault(arguments: dict[str, Any], actor: str) -> dict[str, Any]:
    fault_id = str(arguments.get("faultId") or "").strip()
    if not fault_id:
        return {"ok": False, "error": "faultId is required"}

    resolved_by = str(arguments.get("resolvedBy") or actor).strip() or actor
    note = arguments.get("note")
    note_text = str(note).strip() if isinstance(note, str) and note.strip() else None

    def _mutator(state: dict[str, Any]) -> dict[str, Any]:
        result = resolve_fault(
            state=state,
            fault_id=fault_id,
            resolved_by=resolved_by,
            note=note_text,
        )
        if result is None:
            return {
                "ok": False,
                "error": "fault not found",
                "faultId": fault_id,
            }

        payload = build_status_payload(state)
        return {
            "ok": True,
            "faultId": fault_id,
            "state": "resolved",
            "activeFaults": payload.get("derived", {})
            .get("buildingStats", {})
            .get("activeFaults"),
            "resolvedBy": resolved_by,
            "note": note_text,
        }

    return update_state(_mutator)

def _tool_escalate_fault(arguments: dict[str, Any]) -> dict[str, Any]:
    fault_id = str(arguments.get("faultId") or "").strip()
    to_number = _escalation_phone_number()
    engineer_name = str(arguments.get("engineerName") or "On-Site Engineer").strip()
    building_name_override = str(arguments.get("buildingName") or "").strip()

    if not fault_id:
        return {"ok": False, "error": "faultId is required"}
    if not to_number:
        return {"ok": False, "error": "ESCALATION_PHONE_NUMBER is not set"}

    def _mutator(state: dict[str, Any]) -> dict[str, Any]:
        faults = state.get("faults") if isinstance(state.get("faults"), dict) else {}
        nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}

        fault = faults.get(fault_id) if isinstance(faults, dict) else None
        if not isinstance(fault, dict):
            return {"ok": False, "error": f"fault not found: {fault_id}"}

        node_id = str(fault.get("nodeId") or "").strip()
        node = nodes.get(node_id) if isinstance(nodes, dict) else None

        building_name = building_name_override or str(
            state.get("buildingName") or "Building Operations"
        )
        device_name = (
            str(node.get("label") or node_id) if isinstance(node, dict) else node_id
        )
        severity = str(fault.get("severity") or fault.get("kind") or "unknown")
        detected_at = str(fault.get("openedAt") or utc_now_iso())

        try:
            result = place_outbound_call(
                to_number=to_number,
                building_name=building_name,
                engineer_name=engineer_name,
                product_name=device_name,
                situation_summary=str(
                    fault.get("summary") or "A fault has been detected."
                ),
                failure_name=str(fault.get("kind") or "unknown fault"),
                failure_summary=str(fault.get("summary") or ""),
                likely_cause=str(
                    fault.get("likelyCause")
                    or fault.get("summary")
                    or "under investigation"
                ),
                likely_cause_confidence=str(fault.get("probability") or ""),
                fault_id=fault_id,
                device_id=node_id,
                device_name=device_name,
                severity=severity,
                recommended_action=str(
                    fault.get("recommendedAction") or "Contact operations team."
                ),
                detected_at=detected_at,
                estimated_impact=str(fault.get("estimatedImpact") or ""),
                energy_waste=str(fault.get("energyWaste") or ""),
                triggered_by="Belimo Ops Copilot",
            )
        except (ElevenLabsConfigurationError, ElevenLabsWebhookPayloadError) as exc:
            return {"ok": False, "error": str(exc)}
        except Exception as exc:
            return {"ok": False, "error": f"Call failed: {exc}"}

        return result

    return update_state(_mutator)


def _tool_run_node_diagnosis(node_id: str) -> dict[str, Any]:
    state = read_state()
    nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}
    node = nodes.get(node_id) if isinstance(nodes, dict) else None

    if not isinstance(node, dict):
        return {
            "available": False,
            "nodeId": node_id,
            "error": "node not found",
        }

    try:
        inference = infer_failure_mode_for_node({"id": node_id, **node})
    except MLInferenceError as exc:
        return {
            "available": False,
            "nodeId": node_id,
            "error": str(exc),
        }

    return {
        "available": True,
        "nodeId": node_id,
        "modelType": inference.get("modelType"),
        "task": inference.get("task"),
        "className": inference.get("className"),
        "confidence": inference.get("confidence"),
        "diagnosis": inference.get("diagnosis"),
    }


def _execute_tool(name: str, arguments: dict[str, Any], actor: str) -> dict[str, Any]:
    if name == "get_system_overview":
        return _tool_get_system_overview()

    if name == "get_node_details":
        node_id = str(arguments.get("nodeId") or "").strip()
        if not node_id:
            return {"error": "nodeId is required"}
        return _tool_get_node_details(node_id)

    if name == "get_node_fault_history":
        node_id = str(arguments.get("nodeId") or "").strip()
        if not node_id:
            return {"error": "nodeId is required"}
        limit = _safe_int(arguments.get("limit"), 20, 1, 50)
        return _tool_get_node_fault_history(node_id, limit)

    if name == "resolve_fault":
        return _tool_resolve_fault(arguments, actor=actor)

    if name == "escalate_fault":
        return _tool_escalate_fault(arguments)

    if name == "run_node_diagnosis":
        node_id = str(arguments.get("nodeId") or "").strip()
        if not node_id:
            return {"error": "nodeId is required"}
        return _tool_run_node_diagnosis(node_id)

    return {"error": f"unknown tool: {name}"}


def _openai_request(input_payload: list[dict[str, Any]]) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    response = requests.post(
        OPENAI_RESPONSES_ENDPOINT,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": _agent_model(),
            "instructions": _system_prompt(),
            "input": input_payload,
            "tools": _tool_definitions(),
        },
        timeout=60,
    )

    if response.status_code >= 400:
        snippet = response.text[:400]
        raise RuntimeError(
            f"OpenAI Responses API error {response.status_code}: {snippet}"
        )

    return response.json()


def _fallback_overview_reply(error: str) -> dict[str, Any]:
    overview = _tool_get_system_overview()
    stats = overview.get("buildingStats", {})
    active_faults = stats.get("activeFaults", 0)
    health = stats.get("overallHealth", 0)

    return {
        "reply": (
            "Codex runtime is currently unavailable "
            f"({error}). Live platform status: {active_faults} active faults, "
            f"overall health {health}."
        ),
        "model": "fallback-local",
        "generatedAt": utc_now_iso(),
        "usedFallback": True,
        "toolEvents": [
            {
                "name": "get_system_overview",
                "arguments": {},
                "outcome": "executed",
                "result": overview,
            }
        ],
        "pendingAction": None,
    }


def _pending_action_reply(name: str, arguments: dict[str, Any], action_id: str) -> str:
    if name == "resolve_fault":
        fault_id = str(arguments.get("faultId") or "unknown")
        return (
            f"I can resolve fault `{fault_id}` now. Approve this action to apply the change. "
            f"Pending action id: {action_id}."
        )
    if name == "escalate_fault":
        fault_id = str(arguments.get("faultId") or "unknown")
        to_number = _escalation_phone_number() or "the configured escalation number"
        return (
            f"I am ready to call {to_number} about `{fault_id}`. "
            f"Approve this action to place the call. Pending action id: {action_id}."
        )
    return f"I need approval before executing `{name}`. Pending action id: {action_id}."


def _handle_pending_decision(
    *,
    action_id: str,
    decision: str,
    actor: str,
    prior_conversation: list[dict[str, Any]],
) -> dict[str, Any]:
    pending_action = _pop_pending_action(action_id)
    if pending_action is None:
        return {
            "reply": "That action request is no longer available.",
            "model": _agent_model(),
            "generatedAt": utc_now_iso(),
            "usedFallback": False,
            "toolEvents": [],
            "pendingAction": None,
        }

    name = str(pending_action.get("name") or "")
    arguments = pending_action.get("arguments")
    tool_arguments = arguments if isinstance(arguments, dict) else {}

    if decision == "reject":
        _record_action_event(
            action_name=name,
            arguments=tool_arguments,
            actor=actor,
            outcome="rejected",
            details={"pendingActionId": action_id},
        )
        return {
            "reply": "Action cancelled. I did not change platform state.",
            "model": _agent_model(),
            "generatedAt": utc_now_iso(),
            "usedFallback": False,
            "toolEvents": [
                {
                    "name": name,
                    "arguments": tool_arguments,
                    "outcome": "error",
                    "result": {"message": "action rejected by user"},
                }
            ],
            "pendingAction": None,
        }

    result = _execute_tool(name, tool_arguments, actor=actor)
    _record_action_event(
        action_name=name,
        arguments=tool_arguments,
        actor=actor,
        outcome="executed",
        details={"pendingActionId": action_id, "result": result},
    )

    tool_event = {
        "name": name,
        "arguments": tool_arguments,
        "outcome": "executed",
        "result": result,
    }

    # Run the LLM one more time so the agent gives a natural confirmation.
    try:
        conversation = list(prior_conversation)
        conversation.append(
            {
                "type": "function_call_output",
                "call_id": f"approved-{action_id}",
                "output": _serialize_tool_output(result),
            }
        )
        response_payload = _openai_request(conversation)
        reply = _extract_output_text(response_payload) or "Done."
        model = str(response_payload.get("model") or _agent_model())
    except Exception:
        reply = "The action was executed." + (
            " Call placed successfully."
            if result.get("ok")
            else f" Note: {result.get('error', 'unknown error')}."
        )
        model = _agent_model()

    return {
        "reply": reply,
        "model": model,
        "generatedAt": utc_now_iso(),
        "usedFallback": False,
        "toolEvents": [tool_event],
        "pendingAction": None,
    }


def run_codex_agent_chat(payload: dict[str, Any]) -> dict[str, Any]:
    actor = _normalize_actor(payload.get("actor"))
    pending_action_id = payload.get("pendingActionId")
    pending_action_decision = payload.get("pendingActionDecision")

    if pending_action_id or pending_action_decision:
        action_id = str(pending_action_id or "").strip()
        decision = str(pending_action_decision or "").strip().lower()
        if not action_id or decision not in {"approve", "reject"}:
            return {
                "reply": "Invalid pending action decision payload.",
                "model": _agent_model(),
                "generatedAt": utc_now_iso(),
                "usedFallback": False,
                "toolEvents": [],
                "pendingAction": None,
            }
        raw_messages = payload.get("messages") or []
        prior: list[dict[str, Any]] = [
            {
                "role": str(m.get("role") or "user"),
                "content": str(m.get("content") or ""),
            }
            for m in raw_messages
            if isinstance(m, dict)
            and m.get("role") in {"user", "assistant"}
            and m.get("content")
        ]
        return _handle_pending_decision(
            action_id=action_id,
            decision=decision,
            actor=actor,
            prior_conversation=prior,
        )

    raw_messages = payload.get("messages")
    messages: list[dict[str, str]] = []
    if isinstance(raw_messages, list):
        for item in raw_messages:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip().lower()
            content = str(item.get("content") or "").strip()
            if role not in {"user", "assistant"} or not content:
                continue
            messages.append({"role": role, "content": content})

    if not messages:
        return {
            "reply": "Please send a message so I can help.",
            "model": _agent_model(),
            "generatedAt": utc_now_iso(),
            "usedFallback": False,
            "toolEvents": [],
            "pendingAction": None,
        }

    conversation: list[dict[str, Any]] = [
        {"role": message["role"], "content": message["content"]} for message in messages
    ]
    tool_events: list[dict[str, Any]] = []

    try:
        for _ in range(_max_tool_steps()):
            response_payload = _openai_request(conversation)
            calls = _extract_tool_calls(response_payload)
            conversation.extend(response_payload.get("output", []) or [])

            if not calls:
                text = _extract_output_text(response_payload)
                return {
                    "reply": text or "Done. I am ready for the next instruction.",
                    "model": str(response_payload.get("model") or _agent_model()),
                    "generatedAt": utc_now_iso(),
                    "usedFallback": False,
                    "toolEvents": tool_events,
                    "pendingAction": None,
                }

            for call in calls:
                name = str(call.get("name") or "")
                call_id = str(call.get("callId") or "")
                arguments = _safe_json_loads(str(call.get("arguments") or "{}"))

                if name in _MUTATING_TOOLS:
                    pending = _create_pending_action(name, arguments, actor)
                    tool_events.append(
                        {
                            "name": name,
                            "arguments": arguments,
                            "outcome": "pending_approval",
                            "result": {
                                "pendingActionId": pending["id"],
                            },
                        }
                    )
                    return {
                        "reply": _pending_action_reply(name, arguments, pending["id"]),
                        "model": str(response_payload.get("model") or _agent_model()),
                        "generatedAt": utc_now_iso(),
                        "usedFallback": False,
                        "toolEvents": tool_events,
                        "pendingAction": {
                            "id": pending["id"],
                            "name": name,
                            "summary": _pending_action_summary(name, arguments),
                            "arguments": arguments,
                        },
                    }

                result = _execute_tool(name, arguments, actor=actor)
                tool_events.append(
                    {
                        "name": name,
                        "arguments": arguments,
                        "outcome": "executed",
                        "result": result,
                    }
                )
                conversation.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": _serialize_tool_output(result),
                    }
                )

        return {
            "reply": "I hit the tool step limit before reaching a final answer. Please ask me to continue.",
            "model": _agent_model(),
            "generatedAt": utc_now_iso(),
            "usedFallback": False,
            "toolEvents": tool_events,
            "pendingAction": None,
        }
    except Exception as exc:
        return _fallback_overview_reply(str(exc))
