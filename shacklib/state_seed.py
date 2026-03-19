from __future__ import annotations

import math
import os
import random
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

from shacklib.mock_facility import build_catalog
from shacklib.node_simulator import (
    CATEGORICAL_COL,
    FIELD_MAP,
    PHASE_BINS,
    TELEMETRY_COLS,
    add_noise,
    build_profiles,
    find_dataset,
    load_dataset,
)

_SEVERITY_STATUS = {
    "healthy": "healthy",
    "moderate": "warning",
    "severe": "critical",
}

_STATUS_RANK = {
    "healthy": 0,
    "warning": 1,
    "critical": 2,
    "offline": 3,
}

_SEVERITY_PROFILE_CLASSES = {
    "healthy": ("normal",),
    "moderate": ("resistance", "stabbing"),
    "severe": ("gear_stuck", "bottle_stuck"),
}

_SEVERITY_ANOMALY_SCORE = {
    "healthy": 0.08,
    "moderate": 0.62,
    "severe": 0.91,
}

_ZONE_TO_AHU = {
    "zone-kitchen": "ahu-01",
    "zone-living": "ahu-01",
    "zone-bath": "ahu-02",
    "zone-bed1": "ahu-02",
    "zone-bed2": "ahu-02",
}

_DEVICE_TYPE_PREFIX = {
    "actuator": "ACT",
    "damper": "DMP",
    "valve": "VLV",
}

_PROFILE_CACHE: tuple[str | None, dict[str, np.ndarray]] | None = None


@dataclass(frozen=True)
class StartupSeedConfig:
    mode: str
    node_count: int
    severe_ratio: float
    moderate_ratio: float
    random_seed: int
    history_points: int
    interval_minutes: int
    dataset_path: str | None = None


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    try:
        value = int(float(raw)) if raw is not None else default
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name)
    try:
        value = float(raw) if raw is not None else default
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _resolve_mode(raw_mode: str | None) -> str:
    normalized = (raw_mode or "always").strip().lower()
    if normalized in {"off", "0", "false", "disabled"}:
        return "off"
    if normalized in {"if-empty", "if_empty", "empty"}:
        return "if-empty"
    return "always"


def resolve_startup_seed_config() -> StartupSeedConfig:
    return StartupSeedConfig(
        mode=_resolve_mode(os.getenv("BACKEND_STARTUP_SEED_MODE")),
        node_count=_env_int(
            "BACKEND_STARTUP_SEED_NODE_COUNT", default=8, minimum=1, maximum=500
        ),
        severe_ratio=_env_float(
            "BACKEND_STARTUP_SEED_SEVERE_RATIO",
            default=0.10,
            minimum=0.0,
            maximum=1.0,
        ),
        moderate_ratio=_env_float(
            "BACKEND_STARTUP_SEED_MODERATE_RATIO",
            default=0.10,
            minimum=0.0,
            maximum=1.0,
        ),
        random_seed=_env_int(
            "BACKEND_STARTUP_SEED_RANDOM_SEED",
            default=42,
            minimum=0,
            maximum=2_147_483_647,
        ),
        history_points=_env_int(
            "BACKEND_STARTUP_SEED_HISTORY_POINTS",
            default=PHASE_BINS,
            minimum=8,
            maximum=2_000,
        ),
        interval_minutes=_env_int(
            "BACKEND_STARTUP_SEED_INTERVAL_MINUTES",
            default=5,
            minimum=1,
            maximum=120,
        ),
        dataset_path=_optional_text(os.getenv("BACKEND_STARTUP_SEED_DATASET_PATH")),
    )


def _to_utc_iso(value: datetime) -> str:
    return (
        value.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _load_profile_library(dataset_path: str | None) -> dict[str, np.ndarray]:
    global _PROFILE_CACHE

    cache_key = dataset_path
    if _PROFILE_CACHE is not None and _PROFILE_CACHE[0] == cache_key:
        return _PROFILE_CACHE[1]

    profiles: dict[str, np.ndarray]
    try:
        path = find_dataset(dataset_path)
        df = load_dataset(path)
        profiles = build_profiles(df)
    except Exception:
        profiles = {}

    _PROFILE_CACHE = (cache_key, profiles)
    return profiles


def _fallback_profile(severity: str) -> np.ndarray:
    bases = {
        "healthy": [58.0, 60.0, 6.5, 24.0, 120.0],
        "moderate": [53.0, 57.0, 17.2, 45.0, 140.0],
        "severe": [47.0, 55.0, 24.0, 58.0, 165.0],
    }
    variances = {
        "healthy": [8.0, 6.0, 1.1, 2.4, 20.0],
        "moderate": [11.0, 9.0, 2.0, 4.5, 25.0],
        "severe": [15.0, 12.0, 3.0, 5.5, 35.0],
    }

    base = bases.get(severity, bases["healthy"])
    variance = variances.get(severity, variances["healthy"])
    n_features = len(TELEMETRY_COLS) + 1
    profile = np.zeros((PHASE_BINS, n_features), dtype=np.float64)

    for index in range(PHASE_BINS):
        phase = ((index + 1) / PHASE_BINS) * math.pi * 2.0
        for feature_index in range(len(TELEMETRY_COLS)):
            signal = math.sin(phase + feature_index * 0.41)
            signal += 0.32 * math.cos((phase * 2.0) + feature_index * 0.23)
            value = base[feature_index] + signal * variance[feature_index]
            profile[index, feature_index] = value

    profile[:, -1] = 1.0
    return profile


def _profile_for_severity(
    severity: str,
    profiles: dict[str, np.ndarray],
    chooser: random.Random,
) -> np.ndarray:
    candidates = [
        class_name
        for class_name in _SEVERITY_PROFILE_CLASSES.get(severity, ())
        if class_name in profiles
    ]
    if candidates:
        return profiles[chooser.choice(candidates)]
    return _fallback_profile(severity)


def _issue_counts(
    node_count: int,
    severe_ratio: float,
    moderate_ratio: float,
) -> tuple[int, int]:
    severe_count = int(round(node_count * severe_ratio))
    moderate_count = int(round(node_count * moderate_ratio))

    if node_count >= 5 and severe_ratio > 0 and severe_count == 0:
        severe_count = 1
    severe_count = min(severe_count, node_count)

    remaining = max(0, node_count - severe_count)
    if node_count >= 5 and moderate_ratio > 0 and moderate_count == 0 and remaining > 0:
        moderate_count = 1
    moderate_count = min(moderate_count, remaining)

    return severe_count, moderate_count


def _build_fault(
    *,
    node_id: str,
    severity: str,
    index: int,
    timestamp: str,
) -> dict[str, Any] | None:
    if severity == "healthy":
        return None

    fault_id = f"fault-seed-{index + 1:04d}"
    if severity == "severe":
        probability = _clamp(round(0.9 + (index % 4) * 0.02, 2), 0.5, 0.99)
        kind = "signal_loss"
        summary = "Control signal quality is critically low and actuator response is unstable."
        action = "Inspect wiring and communication bus integrity immediately."
    else:
        probability = _clamp(round(0.67 + (index % 5) * 0.03, 2), 0.5, 0.99)
        kind = "high_torque_anomaly"
        summary = "Torque trend is consistently above expected operating range."
        action = "Inspect linkage and recalibrate the actuator stroke."

    return {
        "id": fault_id,
        "nodeId": node_id,
        "state": "open",
        "kind": kind,
        "probability": probability,
        "summary": summary,
        "recommendedAction": action,
        "openedAt": timestamp,
        "updatedAt": timestamp,
        "resolvedBy": None,
        "note": None,
    }


def _fault_meta_for_severity(severity: str, index: int) -> dict[str, str] | None:
    if severity == "severe":
        impact = 1000 + (index % 5) * 80
        energy = 280 + (index % 5) * 35
        return {
            "estimatedImpact": f"${impact:,}/day cooling inefficiency",
            "energyWaste": f"{energy} kWh/day",
        }

    if severity == "moderate":
        impact = 260 + (index % 5) * 45
        energy = 75 + (index % 5) * 18
        return {
            "estimatedImpact": f"${impact:,}/day energy waste",
            "energyWaste": f"{energy} kWh/day",
        }

    return None


def _severity_signal_base(severity: str) -> tuple[float, float]:
    if severity == "severe":
        return (0.14, 0.03)
    if severity == "moderate":
        return (0.38, 0.05)
    return (0.87, 0.04)


def _apply_severity_adjustment(
    telemetry: dict[str, float],
    *,
    severity: str,
    phase: float,
    phase_shift: float,
) -> dict[str, float]:
    adjusted = dict(telemetry)

    signal_base, signal_amp = _severity_signal_base(severity)
    signal = signal_base + math.sin((phase * math.pi * 2.0) + phase_shift) * signal_amp

    if severity == "severe":
        torque_bias = 13.0
        temp_bias = 12.0
    elif severity == "moderate":
        torque_bias = 7.5
        temp_bias = 6.0
    else:
        torque_bias = -0.5
        temp_bias = -0.8

    adjusted["torque"] = max(0.0, float(adjusted.get("torque", 0.0)) + torque_bias)
    adjusted["temperature"] = float(adjusted.get("temperature", 0.0)) + temp_bias
    adjusted["position_percent"] = _clamp(
        float(adjusted.get("position_percent", 50.0)), 0.0, 100.0
    )
    adjusted["setpoint_position_percent"] = _clamp(
        float(
            adjusted.get(
                "setpoint_position_percent",
                adjusted.get("position_percent", 50.0),
            )
        ),
        0.0,
        100.0,
    )
    adjusted["power_w"] = max(0.0, float(adjusted.get("power_w", 0.0)))
    adjusted["signal"] = _clamp(signal, 0.02, 0.99)

    return adjusted


def _generate_history_from_profile(
    *,
    profile: np.ndarray,
    severity: str,
    node_seed: int,
    history_points: int,
    interval_minutes: int,
    end_at: datetime,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, float], str, float]:
    history: dict[str, list[dict[str, Any]]] = {
        "torque": [],
        "position_percent": [],
        "temperature": [],
        "setpoint_position_percent": [],
        "power_w": [],
        "signal": [],
    }

    rng = np.random.default_rng(node_seed)
    cols = TELEMETRY_COLS + [CATEGORICAL_COL]
    total_rows = max(1, int(profile.shape[0]))
    phase_shift = (node_seed % 17) * 0.19

    for step in range(history_points):
        row = add_noise(profile[step % total_rows], rng)

        telemetry: dict[str, float] = {}
        for index, col in enumerate(cols):
            telemetry[FIELD_MAP[col]] = float(row[index])

        phase = (step + 1) / max(1, history_points)
        adjusted = _apply_severity_adjustment(
            telemetry,
            severity=severity,
            phase=phase,
            phase_shift=phase_shift,
        )

        timestamp = end_at - timedelta(
            minutes=interval_minutes * (history_points - step - 1)
        )
        ts = _to_utc_iso(timestamp)

        history["torque"].append({"time": ts, "value": round(adjusted["torque"], 2)})
        history["position_percent"].append(
            {"time": ts, "value": round(adjusted["position_percent"], 2)}
        )
        history["temperature"].append(
            {"time": ts, "value": round(adjusted["temperature"], 2)}
        )
        history["setpoint_position_percent"].append(
            {"time": ts, "value": round(adjusted["setpoint_position_percent"], 2)}
        )
        history["power_w"].append({"time": ts, "value": round(adjusted["power_w"], 2)})
        history["signal"].append({"time": ts, "value": round(adjusted["signal"], 3)})

    latest = {
        metric: float(series[-1]["value"])
        for metric, series in history.items()
        if isinstance(series, list) and series
    }
    position = round(_clamp(latest.get("position_percent", 0.0) / 100.0, 0.0, 1.0), 4)
    latest["position"] = position

    latest_at = (
        history["torque"][-1]["time"] if history["torque"] else _to_utc_iso(end_at)
    )
    return history, latest, latest_at, position


def _next_device_id(index: int, device_type: str) -> str:
    prefix = _DEVICE_TYPE_PREFIX.get(device_type.lower(), "DEV")
    return f"SIM-{prefix}-{index + 1:03d}"


def _resolve_device_template(
    *,
    base_template: dict[str, Any],
    index: int,
    base_count: int,
    zones_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    template = deepcopy(base_template)
    if index >= base_count:
        template["id"] = _next_device_id(index, str(template.get("type") or "device"))
        template["name"] = (
            f"{template.get('zone', 'Zone')} "
            f"{str(template.get('type') or 'device').capitalize()} {index + 1:03d}"
        )
        template["serial"] = f"SIM-SN-{index + 1:05d}"

        zone = zones_by_id.get(str(template.get("zoneId") or ""))
        if zone:
            x_origin = int(zone.get("x", 0))
            y_origin = int(zone.get("y", 0))
            width = max(int(zone.get("width", 120)), 40)
            height = max(int(zone.get("height", 120)), 40)
            template["x"] = x_origin + 20 + ((index * 53) % max(1, width - 40))
            template["y"] = y_origin + 20 + ((index * 71) % max(1, height - 40))

    return template


def _derive_ahu_status(children: list[dict[str, Any]]) -> str:
    worst_rank = max(
        (
            _STATUS_RANK.get(str(child.get("status") or "healthy"), 0)
            for child in children
        ),
        default=0,
    )
    for status, rank in _STATUS_RANK.items():
        if rank == worst_rank:
            return status
    return "healthy"


def _zone_health_score(statuses: list[str]) -> int:
    if not statuses:
        return 100

    score_map = {
        "healthy": 96,
        "warning": 74,
        "critical": 42,
        "offline": 30,
    }
    avg = sum(score_map.get(status, 96) for status in statuses) / len(statuses)
    return max(0, min(100, int(round(avg))))


def build_startup_seed_state(config: StartupSeedConfig | None = None) -> dict[str, Any]:
    cfg = config or resolve_startup_seed_config()
    chooser = random.Random(cfg.random_seed)
    profiles = _load_profile_library(cfg.dataset_path)

    base_catalog = build_catalog()
    base_templates = (
        base_catalog.get("deviceTemplates")
        if isinstance(base_catalog.get("deviceTemplates"), list)
        else []
    )
    if not base_templates:
        return {
            "nodes": {},
            "faults": {},
            "catalog": {
                "deviceTemplates": [],
                "zones": [],
                "ahuUnits": [],
                "faultMetaByDeviceId": {},
            },
            "meta": {
                "lastIngestAt": None,
                "lastClassificationAt": None,
                "lastFaultResolutionAt": None,
                "seedSource": "mock",
                "seededAt": _to_utc_iso(datetime.now(timezone.utc)),
            },
        }

    severe_count, moderate_count = _issue_counts(
        cfg.node_count,
        cfg.severe_ratio,
        cfg.moderate_ratio,
    )

    selection = list(range(cfg.node_count))
    chooser.shuffle(selection)
    severe_indices = set(selection[:severe_count])
    moderate_indices = set(selection[severe_count : severe_count + moderate_count])

    now = datetime.now(timezone.utc).replace(microsecond=0)
    seeded_at = _to_utc_iso(now)

    zones = deepcopy(base_catalog.get("zones") or [])
    zones_by_id = {
        str(zone.get("id")): zone
        for zone in zones
        if isinstance(zone, dict) and zone.get("id")
    }

    nodes: dict[str, dict[str, Any]] = {}
    faults: dict[str, dict[str, Any]] = {}
    templates: list[dict[str, Any]] = []
    fault_meta_by_device_id: dict[str, dict[str, str]] = {}

    base_count = len(base_templates)
    for index in range(cfg.node_count):
        base_template = base_templates[index % base_count]
        template = _resolve_device_template(
            base_template=base_template,
            index=index,
            base_count=base_count,
            zones_by_id=zones_by_id,
        )

        node_id = str(template.get("id") or _next_device_id(index, "device"))
        node_type = str(template.get("type") or "device")
        if index in severe_indices:
            severity = "severe"
        elif index in moderate_indices:
            severity = "moderate"
        else:
            severity = "healthy"

        profile = _profile_for_severity(severity, profiles, chooser)
        history, latest, latest_at, normalized_position = (
            _generate_history_from_profile(
                profile=profile,
                severity=severity,
                node_seed=cfg.random_seed + index * 17,
                history_points=cfg.history_points,
                interval_minutes=cfg.interval_minutes,
                end_at=now,
            )
        )

        template["id"] = node_id
        template["name"] = str(template.get("name") or node_id)
        template["baseAnomalyScore"] = _SEVERITY_ANOMALY_SCORE[severity]
        template["torque"] = deepcopy(history["torque"])
        template["position"] = deepcopy(history["position_percent"])
        template["temperature"] = deepcopy(history["temperature"])
        templates.append(template)

        parent_id = _ZONE_TO_AHU.get(str(template.get("zoneId") or ""), "ahu-01")
        fault = _build_fault(
            node_id=node_id,
            severity=severity,
            index=index,
            timestamp=latest_at,
        )
        latest_fault_id = None
        if fault is not None:
            latest_fault_id = str(fault["id"])
            faults[latest_fault_id] = fault
            fault_meta = _fault_meta_for_severity(severity, index)
            if fault_meta is not None:
                fault_meta_by_device_id[node_id] = fault_meta

        nodes[node_id] = {
            "id": node_id,
            "label": str(template.get("name") or node_id),
            "type": node_type,
            "status": _SEVERITY_STATUS[severity],
            "position": normalized_position,
            "parentIds": [parent_id],
            "latestTelemetry": {
                "torque": latest.get("torque", 0.0),
                "position_percent": latest.get("position_percent", 0.0),
                "temperature": latest.get("temperature", 0.0),
                "setpoint_position_percent": latest.get(
                    "setpoint_position_percent",
                    latest.get("position_percent", 0.0),
                ),
                "power_w": latest.get("power_w", 0.0),
                "signal": latest.get("signal", 0.9),
                "position": normalized_position,
            },
            "latestTelemetryAt": latest_at,
            "latestFaultId": latest_fault_id,
            "updatedAt": seeded_at,
            "historyByVariable": history,
        }

    ahu_units = deepcopy(base_catalog.get("ahuUnits") or [])
    for ahu in ahu_units:
        if not isinstance(ahu, dict):
            continue
        ahu_id = str(ahu.get("id") or "")
        if not ahu_id:
            continue

        children = [
            node
            for node in nodes.values()
            if isinstance(node.get("parentIds"), list) and ahu_id in node["parentIds"]
        ]
        avg_position = (
            round(
                sum(float(child.get("position") or 0.0) for child in children)
                / max(1, len(children)),
                4,
            )
            if children
            else 0.0
        )
        nodes[ahu_id] = {
            "id": ahu_id,
            "label": str(ahu.get("label") or ahu_id).replace("-", " "),
            "type": "ahu",
            "status": _derive_ahu_status(children),
            "position": avg_position,
            "parentIds": [],
            "latestTelemetry": {"position": avg_position},
            "latestTelemetryAt": seeded_at,
            "latestFaultId": None,
            "updatedAt": seeded_at,
            "historyByVariable": {
                "position": [{"time": seeded_at, "value": avg_position}]
            },
        }

    for zone in zones:
        if not isinstance(zone, dict):
            continue
        zone_id = str(zone.get("id") or "")
        zone_statuses = [
            str(node.get("status") or "healthy")
            for template in templates
            if str(template.get("zoneId") or "") == zone_id
            for node in [nodes.get(str(template.get("id") or ""))]
            if isinstance(node, dict)
        ]
        zone["healthScore"] = _zone_health_score(zone_statuses)

    return {
        "nodes": nodes,
        "faults": faults,
        "catalog": {
            "deviceTemplates": templates,
            "zones": zones,
            "ahuUnits": ahu_units,
            "faultMetaByDeviceId": fault_meta_by_device_id,
        },
        "meta": {
            "lastIngestAt": None,
            "lastClassificationAt": None,
            "lastFaultResolutionAt": None,
            "seedSource": "mock",
            "seededAt": seeded_at,
        },
    }


def seed_state_on_startup(
    state: dict[str, Any],
    config: StartupSeedConfig | None = None,
) -> bool:
    cfg = config or resolve_startup_seed_config()
    if cfg.mode == "off":
        return False

    existing_nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}
    if cfg.mode == "if-empty" and existing_nodes:
        return False

    seeded = build_startup_seed_state(cfg)
    state.clear()
    state.update(seeded)
    return True
