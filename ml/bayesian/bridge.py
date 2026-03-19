from __future__ import annotations

from typing import Any


COMPONENT_ID_TO_BAYES_NODE = {
    "act_intake": "f_act_intake",
    "vlv_ab": "f_vlv_ab",
    "vlv_cd": "f_vlv_cd",
    "act_ef_supply": "f_act_ef_supply",
    "dmp_ab": "f_dmp_ab",
    "act_cd_exhaust": "f_act_cd_exhaust",
    "dmp_ef": "f_dmp_ef",
    "dmp_outlet": "f_dmp_outlet",
}


DEVICE_ID_TO_COMPONENT = {
    "BEL-VNT-001": "act_intake",
    "BEL-VNT-002": "dmp_ab",
    "BEL-VNT-003": "vlv_ab",
    "BEL-VNT-004": "act_cd_exhaust",
    "BEL-VNT-005": "vlv_cd",
    "BEL-VNT-006": "dmp_ef",
    "BEL-VNT-007": "act_ef_supply",
    "BEL-VNT-008": "dmp_outlet",
}


def build_component_failure_priors(
    *,
    requested_failures: list[dict[str, Any]],
    status_payload: dict[str, Any] | None,
) -> dict[str, float]:
    priors = {bayes_id: 0.02 for bayes_id in COMPONENT_ID_TO_BAYES_NODE.values()}

    for failure in requested_failures:
        component_id = str(failure.get("componentId") or "").strip()
        if not component_id:
            continue
        bayes_node_id = COMPONENT_ID_TO_BAYES_NODE.get(component_id)
        if bayes_node_id is None:
            continue
        severity = float(failure.get("severity") or 0.7)
        priors[bayes_node_id] = max(priors[bayes_node_id], _severity_to_prior(severity))

    if status_payload is None:
        return priors

    nodes = status_payload.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id") or "")
            component_id = DEVICE_ID_TO_COMPONENT.get(node_id)
            if component_id is None:
                continue
            bayes_node_id = COMPONENT_ID_TO_BAYES_NODE.get(component_id)
            if bayes_node_id is None:
                continue

            status = str(node.get("status") or "").lower()
            fault = node.get("fault") if isinstance(node.get("fault"), dict) else None
            fault_probability = float(fault.get("probability") or 0.0) if fault else 0.0

            if status == "critical":
                priors[bayes_node_id] = max(priors[bayes_node_id], 0.78)
            elif status == "warning":
                priors[bayes_node_id] = max(priors[bayes_node_id], 0.34)
            elif status == "offline":
                priors[bayes_node_id] = max(priors[bayes_node_id], 0.82)

            if fault_probability > 0:
                priors[bayes_node_id] = max(
                    priors[bayes_node_id], _confidence_to_prior(fault_probability)
                )

    return priors


def _severity_to_prior(severity: float) -> float:
    normalized = max(0.0, min(1.0, severity))
    return 0.22 + 0.72 * normalized


def _confidence_to_prior(confidence: float) -> float:
    normalized = max(0.0, min(1.0, confidence))
    return 0.18 + 0.78 * normalized
