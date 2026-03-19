from __future__ import annotations

from copy import deepcopy
from typing import Any

from shacklib.mock_facility import (
    SEED_GENERATED_AT,
    SEED_SOURCE,
    build_device_templates as _build_legacy_device_templates,
)

FAULT_META_BY_DEVICE_ID: dict[str, dict[str, str]] = {
    "BEL-VNT-003": {
        "estimatedImpact": "$1,200/day cooling inefficiency",
        "energyWaste": "340 kWh/day",
    },
    "BEL-VNT-004": {
        "estimatedImpact": "$400/day energy waste",
        "energyWaste": "120 kWh/day",
    },
    "BEL-VNT-005": {
        "estimatedImpact": "$180/day energy waste",
        "energyWaste": "80 kWh/day",
    },
}

ZONES: list[dict[str, Any]] = [
    {
        "id": "zone-kitchen",
        "name": "Intake Corridor",
        "label": "IN",
        "x": 20,
        "y": 520,
        "width": 120,
        "height": 80,
        "healthScore": 94,
    },
    {
        "id": "zone-row-a",
        "name": "Cold Row A",
        "label": "A",
        "x": 120,
        "y": 190,
        "width": 130,
        "height": 320,
        "healthScore": 67,
    },
    {
        "id": "zone-row-b",
        "name": "Hot Row B",
        "label": "B",
        "x": 270,
        "y": 190,
        "width": 130,
        "height": 320,
        "healthScore": 88,
    },
    {
        "id": "zone-row-c",
        "name": "Cold Row C",
        "label": "C",
        "x": 420,
        "y": 190,
        "width": 130,
        "height": 320,
        "healthScore": 95,
    },
    {
        "id": "zone-row-d",
        "name": "Hot Row D",
        "label": "D",
        "x": 570,
        "y": 190,
        "width": 130,
        "height": 320,
        "healthScore": 84,
    },
    {
        "id": "zone-row-e",
        "name": "Cold Row E",
        "label": "E",
        "x": 720,
        "y": 190,
        "width": 130,
        "height": 320,
        "healthScore": 98,
    },
    {
        "id": "zone-row-f",
        "name": "Hot Row F",
        "label": "F",
        "x": 870,
        "y": 190,
        "width": 130,
        "height": 320,
        "healthScore": 91,
    },
    {
        "id": "zone-bed2",
        "name": "Exhaust Plenum",
        "label": "EX",
        "x": 980,
        "y": 70,
        "width": 150,
        "height": 90,
        "healthScore": 91,
    },
]

AHU_UNITS: list[dict[str, Any]] = [
    {
        "id": "ahu-01",
        "label": "SFA-01",
        "x": 168,
        "y": 625,
        "description": "South supply fan array",
    },
    {
        "id": "ahu-02",
        "label": "EFA-01",
        "x": 1010,
        "y": 55,
        "description": "North exhaust fan array",
    },
]

INITIAL_NODES: list[dict[str, Any]] = [
    {
        "id": "ahu-01",
        "label": "Supply Fan Array",
        "type": "ahu",
        "status": "warning",
        "position": 0.92,
        "parentIds": [],
        "fault": None,
    },
    {
        "id": "ahu-02",
        "label": "Exhaust Fan Array",
        "type": "ahu",
        "status": "warning",
        "position": 0.55,
        "parentIds": [],
        "fault": None,
    },
    {
        "id": "BEL-VNT-001",
        "label": "South Intake Dampener",
        "type": "dampener",
        "status": "healthy",
        "position": 0.95,
        "parentIds": ["ahu-01"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-002",
        "label": "Return Dampener Row B",
        "type": "dampener",
        "status": "healthy",
        "position": 0.58,
        "parentIds": ["ahu-01"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-003",
        "label": "Supply Dampener Row A",
        "type": "dampener",
        "status": "critical",
        "position": 0.12,
        "parentIds": ["ahu-01"],
        "fault": {
            "id": "fault-003",
            "state": "open",
            "kind": "stiction_suspected",
            "probability": 0.91,
            "summary": "Torque signature shows mechanical binding at 45 degree position and the dampener response is lagging the setpoint.",
            "recommendedAction": "Inspect the dampener drive assembly for debris or gear wear and replace it if needed.",
        },
    },
    {
        "id": "BEL-VNT-004",
        "label": "Return Dampener Row D",
        "type": "dampener",
        "status": "warning",
        "position": 0.88,
        "parentIds": ["ahu-01"],
        "fault": {
            "id": "fault-004",
            "state": "open",
            "kind": "control_signal_drift",
            "probability": 0.64,
            "summary": "Position feedback is drifting away from the control signal over the last 72 hours.",
            "recommendedAction": "Recalibrate the position sensor and replace the feedback potentiometer if the drift remains.",
        },
    },
    {
        "id": "BEL-VNT-005",
        "label": "Supply Dampener Row C",
        "type": "dampener",
        "status": "warning",
        "position": 0.76,
        "parentIds": ["ahu-02"],
        "fault": {
            "id": "fault-005",
            "state": "open",
            "kind": "oversized_dampener",
            "probability": 0.52,
            "summary": "The dampener is consistently operating below 30 percent capacity, indicating oversizing for the current load.",
            "recommendedAction": "Review dampener sizing and consider a smaller unit to reduce hunting behavior.",
        },
    },
    {
        "id": "BEL-VNT-006",
        "label": "Return Dampener Row F",
        "type": "dampener",
        "status": "healthy",
        "position": 1.0,
        "parentIds": ["ahu-02"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-007",
        "label": "Supply Dampener Row E",
        "type": "dampener",
        "status": "healthy",
        "position": 0.08,
        "parentIds": ["ahu-02"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-008",
        "label": "North Exhaust Dampener",
        "type": "dampener",
        "status": "healthy",
        "position": 0.42,
        "parentIds": ["ahu-02"],
        "fault": None,
    },
]

_DEVICE_TEMPLATE_OVERRIDES: dict[str, dict[str, Any]] = {
    "BEL-VNT-001": {
        "name": "South Intake Dampener",
        "zone": "Intake Corridor",
        "zoneId": "zone-kitchen",
        "x": 70,
        "y": 567.5,
        "airflowDirection": "supply",
    },
    "BEL-VNT-002": {
        "name": "Return Dampener Row B",
        "zone": "Hot Row B",
        "zoneId": "zone-row-b",
        "x": 350,
        "y": 155,
        "airflowDirection": "return",
    },
    "BEL-VNT-003": {
        "name": "Supply Dampener Row A",
        "zone": "Cold Row A",
        "zoneId": "zone-row-a",
        "x": 200,
        "y": 520,
        "airflowDirection": "supply",
    },
    "BEL-VNT-004": {
        "name": "Return Dampener Row D",
        "zone": "Hot Row D",
        "zoneId": "zone-row-d",
        "x": 650,
        "y": 155,
        "airflowDirection": "return",
    },
    "BEL-VNT-005": {
        "name": "Supply Dampener Row C",
        "zone": "Cold Row C",
        "zoneId": "zone-row-c",
        "x": 500,
        "y": 520,
        "airflowDirection": "supply",
    },
    "BEL-VNT-006": {
        "name": "Return Dampener Row F",
        "zone": "Hot Row F",
        "zoneId": "zone-row-f",
        "x": 950,
        "y": 155,
        "airflowDirection": "return",
    },
    "BEL-VNT-007": {
        "name": "Supply Dampener Row E",
        "zone": "Cold Row E",
        "zoneId": "zone-row-e",
        "x": 800,
        "y": 520,
        "airflowDirection": "supply",
    },
    "BEL-VNT-008": {
        "name": "North Exhaust Dampener",
        "zone": "Exhaust Plenum",
        "zoneId": "zone-bed2",
        "x": 1090,
        "y": 107.5,
        "airflowDirection": "return",
    },
}


def _apply_template_overrides(template: dict[str, Any]) -> dict[str, Any]:
    updated = deepcopy(template)
    override = _DEVICE_TEMPLATE_OVERRIDES.get(str(template.get("id") or ""))
    if override:
        updated.update(deepcopy(override))
    return updated


def build_device_templates() -> list[dict[str, Any]]:
    return [
        _apply_template_overrides(template)
        for template in _build_legacy_device_templates()
    ]


def build_initial_nodes_response() -> dict[str, Any]:
    return {
        "generatedAt": SEED_GENERATED_AT,
        "nodes": deepcopy(INITIAL_NODES),
    }


def build_catalog() -> dict[str, Any]:
    return {
        "deviceTemplates": build_device_templates(),
        "zones": deepcopy(ZONES),
        "ahuUnits": deepcopy(AHU_UNITS),
        "faultMetaByDeviceId": deepcopy(FAULT_META_BY_DEVICE_ID),
    }


def build_seed_state() -> dict[str, Any]:
    catalog = build_catalog()
    templates_by_id = {
        template["id"]: deepcopy(template) for template in catalog["deviceTemplates"]
    }

    nodes: dict[str, dict[str, Any]] = {}
    faults: dict[str, dict[str, Any]] = {}

    for node in deepcopy(INITIAL_NODES):
        template = templates_by_id.get(node["id"])
        history_by_variable: dict[str, list[dict[str, Any]]] = {}

        if template is not None:
            history_by_variable["torque"] = deepcopy(template["torque"])
            history_by_variable["position_percent"] = deepcopy(template["position"])
            history_by_variable["temperature"] = deepcopy(template["temperature"])
            latest_telemetry = {
                "torque": template["torque"][-1]["value"],
                "position_percent": template["position"][-1]["value"],
                "temperature": template["temperature"][-1]["value"],
                "position": node["position"],
            }
        else:
            history_by_variable["position"] = [
                {"time": SEED_GENERATED_AT, "value": node["position"]}
            ]
            latest_telemetry = {"position": node["position"]}

        fault_payload = node.get("fault")
        latest_fault_id = None
        if fault_payload:
            latest_fault_id = fault_payload["id"]
            faults[latest_fault_id] = {
                "id": fault_payload["id"],
                "nodeId": node["id"],
                "state": "open",
                "kind": fault_payload["kind"],
                "probability": fault_payload["probability"],
                "summary": fault_payload["summary"],
                "recommendedAction": fault_payload["recommendedAction"],
                "openedAt": SEED_GENERATED_AT,
                "updatedAt": SEED_GENERATED_AT,
                "resolvedBy": None,
                "note": None,
            }

        nodes[node["id"]] = {
            "id": node["id"],
            "label": node["label"],
            "type": node["type"],
            "status": node["status"],
            "position": node["position"],
            "parentIds": list(node["parentIds"]),
            "latestTelemetry": latest_telemetry,
            "latestTelemetryAt": SEED_GENERATED_AT,
            "latestFaultId": latest_fault_id,
            "updatedAt": SEED_GENERATED_AT,
            "historyByVariable": history_by_variable,
        }

    return {
        "nodes": nodes,
        "faults": faults,
        "catalog": catalog,
        "meta": {
            "lastIngestAt": None,
            "lastClassificationAt": None,
            "lastFaultResolutionAt": None,
            "seedSource": SEED_SOURCE,
            "seededAt": SEED_GENERATED_AT,
        },
    }
