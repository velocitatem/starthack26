from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
FASTAPI_DIR = ROOT / "apps" / "backend" / "fastapi"

for path in (str(ROOT), str(FASTAPI_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

import server  # noqa: E402
from shacklib.ml_inference_client import MLInferenceError  # noqa: E402
from shacklib.mock_datacenter import build_seed_state  # noqa: E402


def test_ml_failure_mode_endpoint_returns_mapped_diagnosis(monkeypatch):
    monkeypatch.setattr(server, "read_state", lambda: build_seed_state())

    def _fake_infer(_node, timeout_seconds=None):
        return {
            "mlUrl": "http://ml-inference:8000",
            "modelType": "xgboost",
            "task": "multiclass",
            "prediction": 3,
            "className": "Gear Jam / Transmission Lock",
            "confidence": 0.92,
            "diagnosis": {
                "status": "critical",
                "kind": "gear_jam_transmission_lock",
                "probability": 0.92,
                "summary": "Dampener transmission behavior matches a potential gear jam.",
                "recommendedAction": "Isolate dampener and inspect gearbox and transmission coupling.",
            },
        }

    monkeypatch.setattr(server, "infer_failure_mode_for_node", _fake_infer)

    with TestClient(server.app) as client:
        response = client.post("/api/ml/failure-mode", json={"nodeId": "BEL-VNT-003"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["nodeId"] == "BEL-VNT-003"
    assert payload["modelType"] == "xgboost"
    assert payload["className"] == "Gear Jam / Transmission Lock"
    assert payload["available"] is True
    assert payload["diagnosis"]["kind"] == "gear_jam_transmission_lock"


def test_ml_failure_mode_endpoint_returns_unavailable_when_ml_fails(monkeypatch):
    monkeypatch.setattr(server, "read_state", lambda: build_seed_state())

    def _raise(_node, timeout_seconds=None):
        raise MLInferenceError("ML endpoint unavailable")

    monkeypatch.setattr(server, "infer_failure_mode_for_node", _raise)

    with TestClient(server.app) as client:
        response = client.post("/api/ml/failure-mode", json={"nodeId": "BEL-VNT-003"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is False
    assert "unavailable" in (payload["error"] or "").lower()


def test_ml_failure_mode_endpoint_returns_404_for_unknown_node(monkeypatch):
    monkeypatch.setattr(server, "read_state", lambda: build_seed_state())

    with TestClient(server.app) as client:
        response = client.post("/api/ml/failure-mode", json={"nodeId": "MISSING"})

    assert response.status_code == 404
