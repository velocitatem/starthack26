from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from shacklib.mock_datacenter import build_catalog, build_seed_state

STATUS_RANK = {
    "healthy": 0,
    "warning": 1,
    "critical": 2,
    "offline": 3,
}

RANK_STATUS = {
    0: "healthy",
    1: "warning",
    2: "critical",
    3: "offline",
}


def utc_now_iso() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return now.isoformat().replace("+00:00", "Z")


def to_utc_iso(value: datetime | str) -> str:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = value.strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        parsed = datetime.fromisoformat(text)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)

    return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _dedupe_ids(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _label_from_node_id(node_id: str) -> str:
    cleaned = node_id.replace("_", "-")
    parts = [part for part in cleaned.split("-") if part]

    if len(parts) >= 2 and parts[-1].isdigit():
        name = parts[-2]
        if name.lower() == "ahu":
            return f"AHU {parts[-1]}"
        return f"{name.capitalize()} {parts[-1]}"

    if parts and parts[0].lower() == "plant":
        return "Plant"

    return cleaned.replace("-", " ").title()


def _new_node(node_id: str, node_type: str, parent_ids: list[str]) -> dict[str, Any]:
    return {
        "id": node_id,
        "label": _label_from_node_id(node_id),
        "type": node_type,
        "status": "healthy",
        "position": 0.0,
        "parentIds": parent_ids,
        "latestTelemetry": {},
        "latestTelemetryAt": None,
        "latestFaultId": None,
        "updatedAt": utc_now_iso(),
        "historyByVariable": {},
    }


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    if isinstance(value, dict):
        return _as_float(value.get("value"))
    return None


def _upsert_history_point(
    series: list[dict[str, Any]], timestamp: str, value: float
) -> list[dict[str, Any]]:
    next_point = {"time": timestamp, "value": round(value, 2)}
    updated = list(series)

    for index, point in enumerate(updated):
        if point.get("time") == timestamp:
            updated[index] = next_point
            break
    else:
        updated.append(next_point)

    updated.sort(key=lambda point: point.get("time") or "")
    return updated


def _normalize_node_position(
    telemetry: dict[str, Any], current_position: float | None
) -> float:
    position_percent = _as_float(telemetry.get("position_percent"))
    if position_percent is not None:
        return round(max(0.0, min(1.0, position_percent / 100.0)), 4)

    position = _as_float(telemetry.get("position"))
    if position is not None:
        normalized = position / 100.0 if position > 1 else position
        return round(max(0.0, min(1.0, normalized)), 4)

    if current_position is not None:
        return round(max(0.0, min(1.0, current_position)), 4)

    return 0.0


def seed_mock_state_if_empty(state: dict[str, Any]) -> bool:
    if state.get("nodes"):
        return False

    seeded = build_seed_state()
    state.clear()
    state.update(seeded)
    return True


def ingest_node(state: dict[str, Any], payload: dict[str, Any]) -> None:
    nodes: dict[str, dict[str, Any]] = state.setdefault("nodes", {})

    node_id = payload["nodeId"]
    parent_ids = _dedupe_ids(payload.get("parentIds", []))
    timestamp = to_utc_iso(payload["timestamp"])
    telemetry = payload.get("telemetry") or {}

    node = nodes.get(node_id)
    if node is None:
        node = _new_node(
            node_id, str(payload.get("deviceType") or "device"), parent_ids
        )
        nodes[node_id] = node

    node["type"] = str(payload.get("deviceType") or node.get("type") or "device")
    node["parentIds"] = parent_ids
    node["label"] = _label_from_node_id(node_id)
    node["updatedAt"] = utc_now_iso()
    node.setdefault("status", "healthy")
    node.setdefault("latestFaultId", None)
    node.setdefault("historyByVariable", {})

    latest_telemetry = dict(node.get("latestTelemetry") or {})
    for key, raw_value in telemetry.items():
        numeric_value = _as_float(raw_value)
        if numeric_value is None:
            continue

        history = node["historyByVariable"].setdefault(key, [])
        node["historyByVariable"][key] = _upsert_history_point(
            history, timestamp, numeric_value
        )
        latest_telemetry[key] = round(numeric_value, 2)

    node["position"] = _normalize_node_position(telemetry, node.get("position"))
    latest_telemetry["position"] = node["position"]
    node["latestTelemetry"] = latest_telemetry
    node["latestTelemetryAt"] = timestamp

    for parent_id in parent_ids:
        if parent_id not in nodes:
            nodes[parent_id] = _new_node(parent_id, "system", [])

    state.setdefault("meta", {})["lastIngestAt"] = utc_now_iso()


def _clamp_probability(value: float) -> float:
    return round(max(0.5, min(0.99, value)), 2)


def _classify_node(node: dict[str, Any]) -> dict[str, Any] | None:
    telemetry = node.get("latestTelemetry") or {}
    node_type = str(node.get("type") or "").lower()

    torque = _as_float(telemetry.get("torque"))
    temperature = _as_float(telemetry.get("temperature"))
    signal = _as_float(telemetry.get("signal"))

    if node_type == "dampener" and torque is not None and torque >= 22:
        return {
            "status": "critical",
            "kind": "stiction_suspected",
            "probability": _clamp_probability(0.85 + (torque - 22) * 0.02),
            "summary": "Dampener movement is irregular and torque is elevated.",
            "recommendedAction": "Inspect for mechanical binding.",
        }

    if torque is not None and torque >= 16:
        return {
            "status": "warning",
            "kind": "high_torque_anomaly",
            "probability": _clamp_probability(0.72 + (torque - 16) * 0.03),
            "summary": "Torque is above expected range.",
            "recommendedAction": "Inspect linkage and dampener drive.",
        }

    if temperature is not None and temperature >= 52:
        return {
            "status": "warning",
            "kind": "temperature_drift",
            "probability": _clamp_probability(0.7 + (temperature - 52) * 0.01),
            "summary": "Device temperature is above expected operating range.",
            "recommendedAction": "Check thermal load and dampener duty cycle.",
        }

    if signal is not None and signal <= 0.2:
        return {
            "status": "critical",
            "kind": "signal_loss",
            "probability": _clamp_probability(0.9 + (0.2 - signal) * 0.2),
            "summary": "Control signal quality is very low.",
            "recommendedAction": "Inspect wiring and communication bus integrity.",
        }

    if signal is not None and signal <= 0.45:
        return {
            "status": "warning",
            "kind": "weak_signal",
            "probability": _clamp_probability(0.66 + (0.45 - signal) * 0.5),
            "summary": "Control signal is weaker than expected.",
            "recommendedAction": "Check shielding and connector quality.",
        }

    return None


def classify_node_heuristic(node: dict[str, Any]) -> dict[str, Any] | None:
    return _classify_node(node)


def _resolve_existing_fault(
    faults: dict[str, dict[str, Any]],
    fault_id: str | None,
    note: str,
) -> None:
    if not fault_id:
        return

    fault = faults.get(fault_id)
    if not fault or fault.get("state") != "open":
        return

    fault["state"] = "resolved"
    fault["resolvedBy"] = "classifier-worker"
    fault["note"] = note
    fault["updatedAt"] = utc_now_iso()


def _attach_fault(
    faults: dict[str, dict[str, Any]],
    node_id: str,
    node: dict[str, Any],
    diagnosis: dict[str, Any],
) -> None:
    now = utc_now_iso()
    current_fault_id = node.get("latestFaultId")
    current_fault = faults.get(current_fault_id) if current_fault_id else None

    if current_fault and current_fault.get("state") == "open":
        if current_fault.get("kind") == diagnosis["kind"]:
            current_fault["probability"] = diagnosis["probability"]
            current_fault["summary"] = diagnosis["summary"]
            current_fault["recommendedAction"] = diagnosis["recommendedAction"]
            current_fault["updatedAt"] = now
            node["status"] = diagnosis["status"]
            return

        _resolve_existing_fault(
            faults,
            current_fault_id,
            "Superseded by a newer classifier signal.",
        )

    fault_id = f"fault-{uuid4().hex[:8]}"
    faults[fault_id] = {
        "id": fault_id,
        "nodeId": node_id,
        "state": "open",
        "kind": diagnosis["kind"],
        "probability": diagnosis["probability"],
        "summary": diagnosis["summary"],
        "recommendedAction": diagnosis["recommendedAction"],
        "openedAt": now,
        "updatedAt": now,
        "resolvedBy": None,
        "note": None,
    }
    node["latestFaultId"] = fault_id
    node["status"] = diagnosis["status"]


def _clear_fault(node: dict[str, Any], faults: dict[str, dict[str, Any]]) -> None:
    current_fault_id = node.get("latestFaultId")
    _resolve_existing_fault(
        faults,
        current_fault_id,
        "Telemetry returned to expected range.",
    )
    node["latestFaultId"] = None
    node["status"] = "healthy"


def _propagate_parent_status(nodes: dict[str, dict[str, Any]]) -> None:
    children: dict[str, list[str]] = defaultdict(list)
    for node_id, node in nodes.items():
        for parent_id in node.get("parentIds", []):
            if parent_id in nodes:
                children[parent_id].append(node_id)

    effective = {
        node_id: node.get("status") if node.get("status") in STATUS_RANK else "healthy"
        for node_id, node in nodes.items()
    }

    changed = True
    while changed:
        changed = False
        for parent_id, child_ids in children.items():
            parent_rank = STATUS_RANK.get(effective.get(parent_id, "healthy"), 0)
            child_rank = max(
                (
                    STATUS_RANK.get(effective.get(child_id, "healthy"), 0)
                    for child_id in child_ids
                ),
                default=0,
            )
            worst_rank = max(parent_rank, child_rank)
            next_status = RANK_STATUS[worst_rank]
            if effective.get(parent_id) != next_status:
                effective[parent_id] = next_status
                changed = True

    for node_id, status in effective.items():
        nodes[node_id]["status"] = status


def run_diagnosis_cycle(
    state: dict[str, Any],
    classifier: Callable[[dict[str, Any]], dict[str, Any] | None] | None = None,
    target_node_ids: set[str] | None = None,
) -> dict[str, int]:
    nodes: dict[str, dict[str, Any]] = state.setdefault("nodes", {})
    faults: dict[str, dict[str, Any]] = state.setdefault("faults", {})

    processed_nodes = 0
    for node_id, node in nodes.items():
        if target_node_ids is not None and node_id not in target_node_ids:
            continue

        telemetry = node.get("latestTelemetry") or {}
        if not telemetry:
            node.setdefault("status", "healthy")
            continue

        processed_nodes += 1
        diagnosis = classifier(node) if classifier else _classify_node(node)
        if diagnosis is None:
            _clear_fault(node, faults)
            continue

        _attach_fault(faults, node_id, node, diagnosis)

    if processed_nodes > 0:
        _propagate_parent_status(nodes)
    state.setdefault("meta", {})["lastClassificationAt"] = utc_now_iso()

    open_faults = sum(1 for fault in faults.values() if fault.get("state") == "open")
    return {
        "processedNodes": processed_nodes,
        "openFaults": open_faults,
    }


def resolve_fault(
    state: dict[str, Any],
    fault_id: str,
    resolved_by: str,
    note: str | None,
) -> dict[str, Any] | None:
    faults: dict[str, dict[str, Any]] = state.setdefault("faults", {})
    nodes: dict[str, dict[str, Any]] = state.setdefault("nodes", {})

    fault = faults.get(fault_id)
    if not fault:
        return None

    now = utc_now_iso()
    fault["state"] = "resolved"
    fault["resolvedBy"] = resolved_by
    fault["note"] = note
    fault["updatedAt"] = now

    node_id = fault.get("nodeId")
    if node_id in nodes and nodes[node_id].get("latestFaultId") == fault_id:
        nodes[node_id]["latestFaultId"] = None
        nodes[node_id]["status"] = "healthy"

    state.setdefault("meta", {})["lastFaultResolutionAt"] = now
    return {
        "ok": True,
        "faultId": fault_id,
        "state": "resolved",
    }


def build_node_fault_history_payload(
    state: dict[str, Any],
    node_id: str,
    limit: int = 25,
) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = state.get("nodes") or {}
    faults: dict[str, dict[str, Any]] = state.get("faults") or {}

    history: list[dict[str, Any]] = []
    for fault in faults.values():
        if not isinstance(fault, dict):
            continue
        if str(fault.get("nodeId") or "") != node_id:
            continue

        history.append(
            {
                "id": str(fault.get("id") or ""),
                "state": str(fault.get("state") or "resolved"),
                "kind": str(fault.get("kind") or "unknown"),
                "probability": round(float(fault.get("probability") or 0.0), 2),
                "summary": str(fault.get("summary") or ""),
                "recommendedAction": str(fault.get("recommendedAction") or ""),
                "openedAt": str(fault.get("openedAt") or utc_now_iso()),
                "updatedAt": str(fault.get("updatedAt") or utc_now_iso()),
                "resolvedBy": fault.get("resolvedBy"),
                "note": fault.get("note"),
            }
        )

    history.sort(
        key=lambda item: str(item.get("updatedAt") or item.get("openedAt") or ""),
        reverse=True,
    )

    node = nodes.get(node_id)
    node_label = (
        node.get("label") if isinstance(node, dict) else _label_from_node_id(node_id)
    )

    clamped_limit = max(1, min(int(limit), 100))
    return {
        "nodeId": node_id,
        "nodeLabel": node_label,
        "totalFaults": len(history),
        "openFaults": sum(1 for item in history if item.get("state") == "open"),
        "faultHistory": history[:clamped_limit],
    }


def _history_series(node: dict[str, Any], key: str) -> list[dict[str, Any]]:
    history_by_variable = node.get("historyByVariable") or {}
    series = history_by_variable.get(key) or []
    return [
        {
            "time": point.get("time") or utc_now_iso(),
            "value": round(float(point.get("value", 0.0)), 2),
        }
        for point in sorted(series, key=lambda item: item.get("time") or "")
    ]


def _history_series_for_percent(node: dict[str, Any]) -> list[dict[str, Any]]:
    direct_percent = _history_series(node, "position_percent")
    if direct_percent:
        return direct_percent

    raw_position = _history_series(node, "position")
    normalized: list[dict[str, Any]] = []
    for point in raw_position:
        value = point["value"]
        normalized.append(
            {
                "time": point["time"],
                "value": round(value * 100 if 0 <= value <= 1 else value, 2),
            }
        )
    return normalized


def _title_case(value: str) -> str:
    return " ".join(part.capitalize() for part in value.split("_"))


def _fault_severity(node_status: str, probability: float) -> str:
    if node_status == "critical":
        return "critical"
    if probability >= 0.6:
        return "high"
    if probability >= 0.4:
        return "medium"
    return "low"


def _device_status(node_status: str | None) -> str:
    if node_status == "critical":
        return "fault"
    if node_status in {"healthy", "warning", "offline"}:
        return node_status
    return "healthy"


def _parse_daily_amount(value: str) -> float:
    digits = "".join(char for char in value if char.isdigit() or char in {".", ","})
    if not digits:
        return 0.0
    return float(digits.replace(",", ""))


def _format_currency_per_day(value: float) -> str:
    return f"${round(value):,}/day"


def _format_energy_waste_per_day(value: float) -> str:
    return f"{round(value)} kWh/day"


def _catalog_from_state(state: dict[str, Any]) -> dict[str, Any]:
    catalog = deepcopy(state.get("catalog") or build_catalog())
    nodes = state.get("nodes") or {}

    for template in catalog.get("deviceTemplates", []):
        node = nodes.get(template.get("id"))
        if not node:
            continue

        torque = _history_series(node, "torque")
        position = _history_series_for_percent(node)
        temperature = _history_series(node, "temperature")
        if torque:
            template["torque"] = torque
        if position:
            template["position"] = position
        if temperature:
            template["temperature"] = temperature

    return catalog


def _open_fault_for_node(
    node: dict[str, Any], faults: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    fault_id = node.get("latestFaultId")
    if not isinstance(fault_id, str):
        return None

    fault = faults.get(fault_id)
    if not fault or fault.get("state") != "open":
        return None

    return fault


def _build_raw_nodes_payload(
    nodes: dict[str, dict[str, Any]], faults: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    for node_id in sorted(nodes.keys()):
        node = nodes[node_id]
        status = node.get("status")
        if status not in STATUS_RANK:
            status = "healthy"

        fault = _open_fault_for_node(node, faults)
        fault_payload = None
        if fault:
            fault_payload = {
                "id": fault.get("id"),
                "state": "open",
                "kind": fault.get("kind"),
                "probability": fault.get("probability", 0.0),
                "summary": fault.get("summary"),
                "recommendedAction": fault.get("recommendedAction"),
            }

        result.append(
            {
                "id": node_id,
                "label": node.get("label") or _label_from_node_id(node_id),
                "type": node.get("type") or "device",
                "status": status,
                "position": round(float(node.get("position") or 0.0), 4),
                "parentIds": node.get("parentIds") or [],
                "fault": fault_payload,
            }
        )

    return result


def _build_history_payload(nodes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for node_id in sorted(nodes.keys()):
        history_by_variable = nodes[node_id].get("historyByVariable") or {}
        payload[node_id] = {
            key: [
                {
                    "time": point.get("time") or utc_now_iso(),
                    "value": round(float(point.get("value", 0.0)), 2),
                }
                for point in sorted(series, key=lambda item: item.get("time") or "")
            ]
            for key, series in sorted(history_by_variable.items())
        }
    return payload


def _build_frontend_faults(
    node: dict[str, Any],
    fault: dict[str, Any] | None,
    fault_meta_by_device_id: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    if not fault:
        return []

    fault_meta = fault_meta_by_device_id.get(node["id"], {})
    return [
        {
            "id": fault.get("id"),
            "type": _title_case(str(fault.get("kind") or "unknown")),
            "severity": _fault_severity(
                str(node.get("status") or "healthy"),
                float(fault.get("probability") or 0.0),
            ),
            "diagnosis": fault.get("summary") or "",
            "recommendation": fault.get("recommendedAction") or "",
            "detectedAt": fault.get("openedAt") or utc_now_iso(),
            "estimatedImpact": fault_meta.get(
                "estimatedImpact", "$0/day impact estimate pending"
            ),
            "energyWaste": fault_meta.get("energyWaste", "0 kWh/day"),
        }
    ]


def _build_derived_devices(
    state: dict[str, Any],
    catalog: dict[str, Any],
    faults: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    nodes = state.get("nodes") or {}
    fault_meta_by_device_id = catalog.get("faultMetaByDeviceId") or {}
    devices: list[dict[str, Any]] = []

    for template in catalog.get("deviceTemplates", []):
        node = nodes.get(template["id"], {})
        open_fault = _open_fault_for_node(node, faults) if node else None
        torque = _history_series(node, "torque") if node else []
        position = _history_series_for_percent(node) if node else []
        temperature = _history_series(node, "temperature") if node else []

        devices.append(
            {
                "id": template["id"],
                "name": template["name"],
                "model": template["model"],
                "serial": template["serial"],
                "type": template["type"],
                "zone": template["zone"],
                "zoneId": template["zoneId"],
                "status": _device_status(node.get("status")),
                "x": template["x"],
                "y": template["y"],
                "installedDate": template["installedDate"],
                "anomalyScore": round(
                    float(open_fault.get("probability"))
                    if open_fault
                    else float(template.get("baseAnomalyScore") or 0.0),
                    2,
                ),
                "airflowDirection": template.get("airflowDirection"),
                "torque": torque or deepcopy(template.get("torque") or []),
                "position": position or deepcopy(template.get("position") or []),
                "temperature": temperature
                or deepcopy(template.get("temperature") or []),
                "faults": _build_frontend_faults(
                    {"id": template["id"], **node},
                    open_fault,
                    fault_meta_by_device_id,
                ),
            }
        )

    return devices


def _build_building_stats(devices: list[dict[str, Any]]) -> dict[str, Any]:
    total_devices = len(devices)
    healthy_devices = sum(1 for device in devices if device["status"] == "healthy")
    warning_devices = sum(1 for device in devices if device["status"] == "warning")
    fault_devices = sum(1 for device in devices if device["status"] == "fault")
    active_faults = sum(len(device["faults"]) for device in devices)

    total_energy_waste = sum(
        _parse_daily_amount(fault["energyWaste"])
        for device in devices
        for fault in device["faults"]
    )
    total_estimated_cost = sum(
        _parse_daily_amount(fault["estimatedImpact"])
        for device in devices
        for fault in device["faults"]
    )

    status_score = {
        "healthy": 100,
        "warning": 78,
        "fault": 42,
        "offline": 20,
    }
    overall_health = (
        0.0
        if total_devices == 0
        else round(
            sum(status_score[device["status"]] for device in devices) / total_devices, 1
        )
    )

    return {
        "totalDevices": total_devices,
        "healthyDevices": healthy_devices,
        "warningDevices": warning_devices,
        "faultDevices": fault_devices,
        "overallHealth": overall_health,
        "energyWaste": _format_energy_waste_per_day(total_energy_waste),
        "estimatedCost": _format_currency_per_day(total_estimated_cost),
        "activeFaults": active_faults,
    }


def build_status_payload(state: dict[str, Any]) -> dict[str, Any]:
    if not state.get("nodes"):
        seed_mock_state_if_empty(state)

    nodes: dict[str, dict[str, Any]] = state.get("nodes", {})
    faults: dict[str, dict[str, Any]] = state.get("faults", {})
    meta: dict[str, Any] = state.get("meta", {})

    catalog = _catalog_from_state(state)
    raw_nodes = _build_raw_nodes_payload(nodes, faults)
    derived_devices = _build_derived_devices(state, catalog, faults)

    return {
        "generatedAt": utc_now_iso(),
        "nodes": raw_nodes,
        "catalog": catalog,
        "historyByNodeId": _build_history_payload(nodes),
        "derived": {
            "devices": derived_devices,
            "buildingStats": _build_building_stats(derived_devices),
            "nodePositions": {
                node["id"]: node["position"] for node in raw_nodes if "id" in node
            },
        },
        "meta": {
            "lastIngestAt": meta.get("lastIngestAt"),
            "lastClassificationAt": meta.get("lastClassificationAt"),
            "lastFaultResolutionAt": meta.get("lastFaultResolutionAt"),
            "seedSource": meta.get("seedSource"),
            "seededAt": meta.get("seededAt"),
        },
    }
