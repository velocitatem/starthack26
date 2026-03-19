from __future__ import annotations

from copy import deepcopy
from math import cos, sin
from typing import Any

SEED_GENERATED_AT = "2026-03-18T14:05:05Z"
SEED_SOURCE = "mock"
_HISTORY_DATE = "2026-03-18"

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
        "name": "Kitchen",
        "label": "K",
        "x": 25,
        "y": 25,
        "width": 280,
        "height": 255,
        "healthScore": 94,
    },
    {
        "id": "zone-living",
        "name": "Living Room",
        "label": "L",
        "x": 308,
        "y": 25,
        "width": 487,
        "height": 295,
        "healthScore": 67,
    },
    {
        "id": "zone-bath",
        "name": "Bathroom",
        "label": "B",
        "x": 25,
        "y": 288,
        "width": 153,
        "height": 182,
        "healthScore": 88,
    },
    {
        "id": "zone-bed1",
        "name": "Bedroom 1",
        "label": "1",
        "x": 588,
        "y": 328,
        "width": 207,
        "height": 267,
        "healthScore": 98,
    },
    {
        "id": "zone-bed2",
        "name": "Bedroom 2",
        "label": "2",
        "x": 186,
        "y": 408,
        "width": 244,
        "height": 187,
        "healthScore": 91,
    },
]

AHU_UNITS: list[dict[str, Any]] = [
    {
        "id": "ahu-01",
        "label": "AHU-01",
        "x": 310,
        "y": 240,
        "description": "Kitchen & Living",
    },
    {
        "id": "ahu-02",
        "label": "AHU-02",
        "x": 460,
        "y": 370,
        "description": "Bedrooms & Bath",
    },
]

INITIAL_NODES: list[dict[str, Any]] = [
    {
        "id": "ahu-01",
        "label": "AHU 01",
        "type": "ahu",
        "status": "warning",
        "position": 0.92,
        "parentIds": [],
        "fault": None,
    },
    {
        "id": "ahu-02",
        "label": "AHU 02",
        "type": "ahu",
        "status": "warning",
        "position": 0.55,
        "parentIds": [],
        "fault": None,
    },
    {
        "id": "BEL-VNT-001",
        "label": "Kitchen Supply Dampener",
        "type": "dampener",
        "status": "healthy",
        "position": 0.95,
        "parentIds": ["ahu-01"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-002",
        "label": "Kitchen Exhaust Dampener",
        "type": "dampener",
        "status": "healthy",
        "position": 0.0,
        "parentIds": ["ahu-01"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-003",
        "label": "Living Room Supply Dampener",
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
        "label": "Living Room Return Dampener",
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
        "label": "Bathroom Exhaust Dampener",
        "type": "dampener",
        "status": "warning",
        "position": 0.0,
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
        "label": "Bedroom 1 Supply Dampener",
        "type": "dampener",
        "status": "healthy",
        "position": 1.0,
        "parentIds": ["ahu-02"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-007",
        "label": "Bedroom 1 Return Dampener",
        "type": "dampener",
        "status": "healthy",
        "position": 0.08,
        "parentIds": ["ahu-02"],
        "fault": None,
    },
    {
        "id": "BEL-VNT-008",
        "label": "Bedroom 2 Fresh Air Dampener",
        "type": "dampener",
        "status": "healthy",
        "position": 0.42,
        "parentIds": ["ahu-02"],
        "fault": None,
    },
]

_DEVICE_TEMPLATE_SPECS: list[dict[str, Any]] = [
    {
        "id": "BEL-VNT-001",
        "name": "Kitchen Supply Dampener",
        "model": "LMV-D3",
        "serial": "SN-88421",
        "type": "dampener",
        "zone": "Kitchen",
        "zoneId": "zone-kitchen",
        "x": 160,
        "y": 210,
        "installedDate": "2024-06-15",
        "baseAnomalyScore": 0.12,
        "airflowDirection": "supply",
        "telemetry": {
            "torque": (4.2, 0.8, False, "free"),
            "position": (72.0, 15.0, False, "percent"),
            "temperature": (23.0, 2.0, False, "temperature"),
        },
    },
    {
        "id": "BEL-VNT-002",
        "name": "Kitchen Exhaust Dampener",
        "model": "NMV-D2M",
        "serial": "SN-88422",
        "type": "dampener",
        "zone": "Kitchen",
        "zoneId": "zone-kitchen",
        "x": 80,
        "y": 100,
        "installedDate": "2024-06-15",
        "baseAnomalyScore": 0.08,
        "airflowDirection": "return",
        "telemetry": {
            "torque": (3.8, 0.5, False, "free"),
            "position": (65.0, 10.0, False, "percent"),
            "temperature": (22.0, 1.5, False, "temperature"),
        },
    },
    {
        "id": "BEL-VNT-003",
        "name": "Living Room Supply Dampener",
        "model": "R2025-S2",
        "serial": "SN-71004",
        "type": "dampener",
        "zone": "Living Room",
        "zoneId": "zone-living",
        "x": 550,
        "y": 100,
        "installedDate": "2023-11-20",
        "baseAnomalyScore": 0.91,
        "airflowDirection": None,
        "telemetry": {
            "torque": (6.8, 2.5, True, "free"),
            "position": (45.0, 30.0, True, "percent"),
            "temperature": (28.0, 5.0, True, "temperature"),
        },
    },
    {
        "id": "BEL-VNT-004",
        "name": "Living Room Return Dampener",
        "model": "LMV-D3",
        "serial": "SN-71005",
        "type": "dampener",
        "zone": "Living Room",
        "zoneId": "zone-living",
        "x": 700,
        "y": 200,
        "installedDate": "2024-01-10",
        "baseAnomalyScore": 0.64,
        "airflowDirection": "supply",
        "telemetry": {
            "torque": (5.1, 1.8, True, "free"),
            "position": (80.0, 20.0, False, "percent"),
            "temperature": (26.0, 3.0, False, "temperature"),
        },
    },
    {
        "id": "BEL-VNT-005",
        "name": "Bathroom Exhaust Dampener",
        "model": "AF24-MFT",
        "serial": "SN-55301",
        "type": "dampener",
        "zone": "Bathroom",
        "zoneId": "zone-bath",
        "x": 100,
        "y": 380,
        "installedDate": "2024-03-22",
        "baseAnomalyScore": 0.52,
        "airflowDirection": None,
        "telemetry": {
            "torque": (3.2, 1.2, False, "free"),
            "position": (55.0, 18.0, False, "percent"),
            "temperature": (21.0, 2.0, False, "temperature"),
        },
    },
    {
        "id": "BEL-VNT-006",
        "name": "Bedroom 1 Supply Dampener",
        "model": "R2015-S1",
        "serial": "SN-55302",
        "type": "dampener",
        "zone": "Bedroom 1",
        "zoneId": "zone-bed1",
        "x": 700,
        "y": 450,
        "installedDate": "2025-01-08",
        "baseAnomalyScore": 0.05,
        "airflowDirection": "supply",
        "telemetry": {
            "torque": (2.8, 0.4, False, "free"),
            "position": (60.0, 8.0, False, "percent"),
            "temperature": (42.0, 3.0, False, "temperature"),
        },
    },
    {
        "id": "BEL-VNT-007",
        "name": "Bedroom 1 Return Dampener",
        "model": "LMV-D3",
        "serial": "SN-99100",
        "type": "dampener",
        "zone": "Bedroom 1",
        "zoneId": "zone-bed1",
        "x": 750,
        "y": 550,
        "installedDate": "2025-02-14",
        "baseAnomalyScore": 0.03,
        "airflowDirection": "return",
        "telemetry": {
            "torque": (3.5, 0.3, False, "free"),
            "position": (70.0, 5.0, False, "percent"),
            "temperature": (22.0, 1.0, False, "temperature"),
        },
    },
    {
        "id": "BEL-VNT-008",
        "name": "Bedroom 2 Fresh Air Dampener",
        "model": "NMV-D2M",
        "serial": "SN-99101",
        "type": "dampener",
        "zone": "Bedroom 2",
        "zoneId": "zone-bed2",
        "x": 350,
        "y": 520,
        "installedDate": "2025-02-14",
        "baseAnomalyScore": 0.07,
        "airflowDirection": "supply",
        "telemetry": {
            "torque": (2.9, 0.5, False, "free"),
            "position": (50.0, 10.0, False, "percent"),
            "temperature": (20.0, 1.5, False, "temperature"),
        },
    },
]


def _round(value: float) -> float:
    return round(value, 2)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _series_value(base: float, variance: float, hour: int, anomaly: bool, mode: str) -> float:
    wave = sin((hour + 1) * 1.11) * variance * 0.33
    wave += cos((hour + 1) * 0.47) * variance * 0.17
    value = base + wave
    if anomaly and hour > 18:
        value += variance * 2

    if mode == "percent":
        value = _clamp(value, 0.0, 100.0)
    elif mode == "temperature":
        value = max(value, -20.0)
    else:
        value = max(value, 0.0)

    return _round(value)


def _generate_history(
    base: float, variance: float, anomaly: bool = False, mode: str = "free"
) -> list[dict[str, Any]]:
    return [
        {
            "time": f"{_HISTORY_DATE}T{hour:02d}:00:00Z",
            "value": _series_value(base, variance, hour, anomaly, mode),
        }
        for hour in range(24)
    ]


def build_device_templates() -> list[dict[str, Any]]:
    templates: list[dict[str, Any]] = []
    for spec in _DEVICE_TEMPLATE_SPECS:
        telemetry = spec["telemetry"]
        templates.append(
            {
                "id": spec["id"],
                "name": spec["name"],
                "model": spec["model"],
                "serial": spec["serial"],
                "type": spec["type"],
                "zone": spec["zone"],
                "zoneId": spec["zoneId"],
                "x": spec["x"],
                "y": spec["y"],
                "installedDate": spec["installedDate"],
                "baseAnomalyScore": spec["baseAnomalyScore"],
                "airflowDirection": spec["airflowDirection"],
                "torque": _generate_history(*telemetry["torque"]),
                "position": _generate_history(*telemetry["position"]),
                "temperature": _generate_history(*telemetry["temperature"]),
            }
        )
    return templates


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
        latest_telemetry: dict[str, float] = {}

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
