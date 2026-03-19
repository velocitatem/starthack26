from __future__ import annotations

import json
import os
from math import sqrt
from typing import Any
from urllib import error, request

DEFAULT_ML_URL = "http://localhost:8200"
DEFAULT_ML_TIMEOUT_SECONDS = 3.0
_WINDOW_SIZE = 24

_NORMAL_CLASS_NAMES = {
    "Normal",
    "Normal Operation",
    "Healthy",
    "No Fault",
}

_FAILURE_MODE_MAP = {
    "Valve Destabilization (Repeated Poking)": {
        "status": "warning",
        "kind": "dampener_destabilization",
        "summary": "Dampener position is oscillating and control is unstable.",
        "recommendedAction": "Inspect control loop tuning and dampener linkage for repeated hunting.",
    },
    "Closure Blockage (Bottle Held Open)": {
        "status": "critical",
        "kind": "closure_blockage",
        "summary": "Dampener cannot fully close and appears physically blocked.",
        "recommendedAction": "Inspect for obstruction and verify full travel at closed setpoint.",
    },
    "Gear Jam / Transmission Lock": {
        "status": "critical",
        "kind": "gear_jam_transmission_lock",
        "summary": "Dampener transmission behavior matches a potential gear jam.",
        "recommendedAction": "Isolate dampener and inspect gearbox and transmission coupling.",
    },
    "Added Mechanical Resistance": {
        "status": "warning",
        "kind": "added_mechanical_resistance",
        "summary": "Mechanical load has increased and movement requires elevated effort.",
        "recommendedAction": "Inspect stem friction, alignment, and lubrication condition.",
    },
    "Anomaly": {
        "status": "warning",
        "kind": "anomaly_detected",
        "summary": "Telemetry pattern deviates from learned normal operation.",
        "recommendedAction": "Inspect the dampener and validate commissioning parameters.",
    },
}

_DISPLAY_CLASS_NAME_MAP = {
    "Valve Destabilization (Repeated Poking)": "Dampener Destabilization (Repeated Poking)",
}


class MLInferenceError(RuntimeError):
    pass


def resolve_ml_url(explicit_url: str | None = None) -> str:
    raw = (explicit_url or os.getenv("ML_URL") or DEFAULT_ML_URL).strip()
    if not raw:
        return DEFAULT_ML_URL
    return raw.rstrip("/")


def resolve_ml_timeout_seconds(explicit_timeout: float | None = None) -> float:
    if explicit_timeout is not None:
        value = explicit_timeout
    else:
        raw = os.getenv("ML_TIMEOUT_SECONDS", str(DEFAULT_ML_TIMEOUT_SECONDS))
        try:
            value = float(raw)
        except ValueError:
            value = DEFAULT_ML_TIMEOUT_SECONDS
    return max(0.2, min(30.0, value))


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


def _round(value: float) -> float:
    return round(value, 4)


def _window(
    values: list[float], length: int = _WINDOW_SIZE, fallback: float = 0.0
) -> list[float]:
    if not values:
        return [fallback] * length
    if len(values) >= length:
        return values[-length:]
    pad = [values[0]] * (length - len(values))
    return pad + values


def _history_values(node: dict[str, Any], key: str) -> list[float]:
    history_by_variable = node.get("historyByVariable")
    if isinstance(history_by_variable, dict):
        series = history_by_variable.get(key)
        if isinstance(series, list):
            parsed = [_as_float(point) for point in series]
            numeric = [value for value in parsed if value is not None]
            if numeric:
                return numeric[-_WINDOW_SIZE:]

    latest_telemetry = node.get("latestTelemetry")
    if isinstance(latest_telemetry, dict):
        latest = _as_float(latest_telemetry.get(key))
        if latest is not None:
            return [latest]

    return []


def _position_percent_values(node: dict[str, Any]) -> list[float]:
    series = _history_values(node, "position_percent")
    if not series:
        raw_position = _history_values(node, "position")
        series = [
            value * 100 if 0.0 <= value <= 1.0 else value for value in raw_position
        ]

    if not series:
        latest_position = _as_float((node.get("latestTelemetry") or {}).get("position"))
        if latest_position is not None:
            value = (
                latest_position * 100
                if 0.0 <= latest_position <= 1.0
                else latest_position
            )
            series = [value]

    return [max(0.0, min(100.0, value)) for value in series]


def _derive_setpoint(
    feedback_position: list[float], node: dict[str, Any]
) -> list[float]:
    signal = _history_values(node, "signal")
    if not signal:
        return list(feedback_position)

    normalized_signal = [
        value * 100 if 0.0 <= value <= 1.0 else value
        for value in _window(signal, len(feedback_position), 100.0)
    ]
    return [
        max(
            0.0,
            min(
                100.0, feedback_position[index] * 0.85 + normalized_signal[index] * 0.15
            ),
        )
        for index in range(len(feedback_position))
    ]


def _derive_velocity(position_percent: list[float]) -> list[float]:
    if not position_percent:
        return [0.0]

    velocity = [0.0]
    for index in range(1, len(position_percent)):
        velocity.append(position_percent[index] - position_percent[index - 1])
    return velocity


def _ema(values: list[float], alpha: float = 0.3) -> list[float]:
    if not values:
        return []

    current = values[0]
    result: list[float] = []
    for value in values:
        current = alpha * value + (1.0 - alpha) * current
        result.append(current)
    return result


def _five_stats(values: list[float]) -> list[float]:
    if not values:
        return [0.0, 0.0, 0.0, 0.0, 0.0]

    mean_value = sum(values) / len(values)
    variance = sum((value - mean_value) ** 2 for value in values) / len(values)
    std_dev = sqrt(variance)
    return [
        _round(mean_value),
        _round(std_dev),
        _round(min(values)),
        _round(max(values)),
        _round(values[-1] - values[0]),
    ]


def _rotation_metrics(velocity: list[float]) -> tuple[float, float]:
    signs: list[float] = []
    for value in velocity:
        if value > 0.2:
            signs.append(1.0)
        elif value < -0.2:
            signs.append(-1.0)
        else:
            signs.append(0.0)

    counts = {
        -1.0: signs.count(-1.0),
        0.0: signs.count(0.0),
        1.0: signs.count(1.0),
    }
    dominant_sign = max(counts, key=lambda key: counts[key])

    non_zero_signs = [sign for sign in signs if sign != 0.0]
    sign_changes = 0
    for index in range(1, len(non_zero_signs)):
        if non_zero_signs[index] != non_zero_signs[index - 1]:
            sign_changes += 1

    return _round(dominant_sign), float(sign_changes)


def build_mlp_features_for_node(node: dict[str, Any]) -> list[float]:
    feedback_position = _window(_position_percent_values(node))
    setpoint_position = _derive_setpoint(feedback_position, node)
    position_error = [
        setpoint_position[index] - feedback_position[index]
        for index in range(len(feedback_position))
    ]

    latest_telemetry = (
        node.get("latestTelemetry")
        if isinstance(node.get("latestTelemetry"), dict)
        else {}
    )

    torque_fallback = _as_float((latest_telemetry or {}).get("torque")) or 0.0
    torque = _window(
        _history_values(node, "torque"), len(feedback_position), torque_fallback
    )

    temperature_fallback = (
        _as_float((latest_telemetry or {}).get("temperature")) or 22.0
    )
    internal_temperature = _window(
        _history_values(node, "temperature"),
        len(feedback_position),
        temperature_fallback,
    )

    velocity = _window(_derive_velocity(feedback_position), len(feedback_position), 0.0)

    power = [
        4.0 + abs(torque[index]) * 0.09 + abs(velocity[index]) * 0.04
        for index in range(len(feedback_position))
    ]
    pipe_air_flow = [
        max(0.0, 100.0 + velocity[index] * 1.5 - max(0.0, torque[index] - 12.0) * 1.8)
        for index in range(len(feedback_position))
    ]
    pipe_air_temperature = [
        internal_temperature[index]
        - min(3.0, max(0.0, pipe_air_flow[index] - 95.0) * 0.03)
        + max(0.0, torque[index] - 10.0) * 0.06
        for index in range(len(feedback_position))
    ]

    pipe_air_flow_ema = _ema(pipe_air_flow)
    pipe_air_temperature_ema = _ema(pipe_air_temperature)
    rotation_mode, rotation_change_count = _rotation_metrics(velocity)

    feature_groups = [
        feedback_position,
        setpoint_position,
        position_error,
        torque,
        power,
        internal_temperature,
        pipe_air_flow,
        pipe_air_temperature,
        pipe_air_flow_ema,
        pipe_air_temperature_ema,
    ]

    features: list[float] = []
    for group in feature_groups:
        features.extend(_five_stats(group))

    features.extend([rotation_mode, rotation_change_count])
    features.extend(_five_stats(velocity))

    if len(features) != 57:
        raise MLInferenceError(f"Expected 57 features, generated {len(features)}")

    return features


def _post_json(
    url: str, payload: dict[str, Any], timeout_seconds: float
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            content = response.read().decode("utf-8")
    except error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="ignore")
        raise MLInferenceError(
            f"ML API request failed ({exc.code}) at {url}: {error_body[:240]}"
        ) from exc
    except error.URLError as exc:
        raise MLInferenceError(f"ML API is unreachable at {url}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise MLInferenceError(f"ML API request timed out at {url}") from exc

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise MLInferenceError(f"ML API returned invalid JSON from {url}") from exc

    if not isinstance(parsed, dict):
        raise MLInferenceError("ML API returned an unexpected response payload")

    return parsed


def _normalize_class_name(class_name: Any) -> str | None:
    if isinstance(class_name, str):
        text = class_name.strip()
        return text or None
    if isinstance(class_name, list):
        for value in class_name:
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _confidence(prediction: Any, probabilities: Any) -> float | None:
    if not isinstance(probabilities, list):
        return None

    numeric = [
        float(value)
        for value in probabilities
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    if not numeric:
        return None

    if isinstance(prediction, int) and 0 <= prediction < len(numeric):
        return _round(numeric[prediction])

    return _round(max(numeric))


def diagnosis_from_prediction(
    prediction_payload: dict[str, Any],
) -> dict[str, Any] | None:
    class_name = _normalize_class_name(prediction_payload.get("class_name"))
    prediction = prediction_payload.get("prediction")
    confidence = _confidence(prediction, prediction_payload.get("probabilities"))

    if class_name in _NORMAL_CLASS_NAMES or (class_name is None and prediction == 0):
        return None

    mapped = _FAILURE_MODE_MAP.get(class_name or "")
    if mapped is None:
        summary_label = class_name or "Unclassified anomaly"
        mapped = {
            "status": "warning",
            "kind": "ml_detected_fault",
            "summary": f"ML model detected fault pattern: {summary_label}.",
            "recommendedAction": "Inspect dampener behavior and validate commissioning parameters.",
        }

    probability = confidence if confidence is not None else 0.65
    probability = round(max(0.5, min(0.99, probability)), 2)

    return {
        "status": mapped["status"],
        "kind": mapped["kind"],
        "probability": probability,
        "summary": mapped["summary"],
        "recommendedAction": mapped["recommendedAction"],
    }


def infer_failure_mode_for_node(
    node: dict[str, Any],
    *,
    ml_url: str | None = None,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    node_id = str(node.get("id") or "").strip()
    if not node_id:
        raise MLInferenceError("Node payload must include an id")

    features = build_mlp_features_for_node(node)
    base_url = resolve_ml_url(ml_url)
    timeout = resolve_ml_timeout_seconds(timeout_seconds)
    payload = _post_json(
        f"{base_url}/predict/mlp",
        {"features": features},
        timeout,
    )

    class_name = _normalize_class_name(payload.get("class_name"))
    display_class_name = (
        _DISPLAY_CLASS_NAME_MAP.get(class_name, class_name)
        if class_name is not None
        else None
    )
    confidence = _confidence(payload.get("prediction"), payload.get("probabilities"))

    prediction = payload.get("prediction")
    normalized_prediction = prediction if isinstance(prediction, int) else None

    return {
        "nodeId": node_id,
        "mlUrl": base_url,
        "modelType": payload.get("model_type"),
        "task": payload.get("task"),
        "prediction": normalized_prediction,
        "className": display_class_name,
        "confidence": confidence,
        "diagnosis": diagnosis_from_prediction(payload),
        "raw": payload,
    }
