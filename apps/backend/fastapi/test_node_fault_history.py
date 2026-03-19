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
from shacklib.mock_datacenter import build_seed_state  # noqa: E402


def test_node_fault_history_returns_open_and_resolved_entries(monkeypatch):
    state = build_seed_state()
    state["faults"]["fault-old-003"] = {
        "id": "fault-old-003",
        "nodeId": "BEL-VLV-003",
        "state": "resolved",
        "kind": "weak_signal",
        "probability": 0.66,
        "summary": "Historic weak signal anomaly.",
        "recommendedAction": "Inspect connector and shielding.",
        "openedAt": "2026-03-16T10:00:00Z",
        "updatedAt": "2026-03-16T12:00:00Z",
        "resolvedBy": "test-user",
        "note": "resolved during test",
    }

    monkeypatch.setattr(server, "read_state", lambda: state)

    with TestClient(server.app) as client:
        response = client.get("/api/nodes/BEL-VLV-003/fault-history?limit=10")

    assert response.status_code == 200
    payload = response.json()

    assert payload["nodeId"] == "BEL-VLV-003"
    assert payload["totalFaults"] == 2
    assert payload["openFaults"] == 1
    assert {entry["state"] for entry in payload["faultHistory"]} == {"open", "resolved"}


def test_node_fault_history_returns_404_for_unknown_node(monkeypatch):
    monkeypatch.setattr(server, "read_state", lambda: build_seed_state())

    with TestClient(server.app) as client:
        response = client.get("/api/nodes/UNKNOWN/fault-history")

    assert response.status_code == 404
