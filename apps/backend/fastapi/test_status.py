from __future__ import annotations

import sys
from copy import deepcopy
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
FASTAPI_DIR = ROOT / "apps" / "backend" / "fastapi"

for path in (str(ROOT), str(FASTAPI_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

import server  # noqa: E402
from shacklib import backend_state  # noqa: E402
from shacklib.diagnosis_engine import (  # noqa: E402
    build_status_payload,
    ingest_node,
    seed_mock_state_if_empty,
)
from shacklib.mock_datacenter import build_seed_state  # noqa: E402


def test_status_endpoint_returns_aggregate_payload(monkeypatch):
    state = build_seed_state()

    monkeypatch.setattr(server, "ensure_storage_ready", lambda: None)
    monkeypatch.setattr(server, "update_state", lambda mutator: mutator(state))

    with TestClient(server.app) as client:
        response = client.get("/api/status")

    assert response.status_code == 200
    payload = response.json()

    assert {
        "generatedAt",
        "nodes",
        "catalog",
        "historyByNodeId",
        "derived",
        "meta",
    } <= payload.keys()
    assert all("position" in node for node in payload["nodes"])
    assert len(payload["derived"]["devices"]) == 8
    assert payload["derived"]["devices"][0]["id"] == "BEL-ACT-001"
    assert payload["derived"]["devices"][0]["name"] == "South Intake Actuator"
    assert payload["catalog"]["ahuUnits"][0]["label"] == "SFA-01"


def test_seed_mock_state_if_empty_only_runs_once():
    state = {
        "nodes": {},
        "faults": {},
        "catalog": {},
        "meta": {},
    }

    assert seed_mock_state_if_empty(state) is True
    seeded_snapshot = deepcopy(state)

    assert seed_mock_state_if_empty(state) is False
    assert state == seeded_snapshot


def test_ingest_node_appends_and_overwrites_history_points():
    state = build_seed_state()

    ingest_node(
        state,
        {
            "nodeId": "BEL-ACT-001",
            "timestamp": "2026-03-19T10:00:00Z",
            "deviceType": "actuator",
            "parentIds": ["ahu-01"],
            "telemetry": {
                "torque": 9.1,
                "position_percent": 66.0,
                "temperature": 24.5,
            },
        },
    )
    ingest_node(
        state,
        {
            "nodeId": "BEL-ACT-001",
            "timestamp": "2026-03-19T10:00:00Z",
            "deviceType": "actuator",
            "parentIds": ["ahu-01"],
            "telemetry": {
                "torque": 8.4,
                "position_percent": 68.0,
                "temperature": 24.0,
            },
        },
    )

    payload = build_status_payload(state)
    torque_history = payload["historyByNodeId"]["BEL-ACT-001"]["torque"]
    position_history = payload["historyByNodeId"]["BEL-ACT-001"]["position_percent"]

    matching_torque_points = [
        point for point in torque_history if point["time"] == "2026-03-19T10:00:00Z"
    ]

    assert len(matching_torque_points) == 1
    assert matching_torque_points[0]["value"] == 8.4
    assert position_history[-1]["value"] == 68.0
    assert payload["derived"]["nodePositions"]["BEL-ACT-001"] == 0.68


def test_derived_data_stays_consistent_with_devices_and_nodes():
    payload = build_status_payload(build_seed_state())
    devices = payload["derived"]["devices"]
    stats = payload["derived"]["buildingStats"]
    raw_nodes = {node["id"]: node for node in payload["nodes"]}

    assert stats["totalDevices"] == len(devices)
    assert stats["activeFaults"] == sum(len(device["faults"]) for device in devices)
    assert (
        payload["derived"]["nodePositions"]["ahu-01"] == raw_nodes["ahu-01"]["position"]
    )


def test_backend_state_falls_back_to_memory_without_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(backend_state, "_SCHEMA_READY", False)
    monkeypatch.setattr(backend_state, "_MEMORY_STATE", None)

    backend_state.ensure_storage_ready()
    initial_state = backend_state.read_state()
    assert initial_state["nodes"] == {}

    def _mutator(state):
        state["meta"]["seedSource"] = "mock"
        return "ok"

    assert backend_state.update_state(_mutator) == "ok"
    assert backend_state.read_state()["meta"]["seedSource"] == "mock"


def test_building_document_helpers_work_in_memory_mode(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(backend_state, "_SCHEMA_READY", False)
    monkeypatch.setattr(backend_state, "_MEMORY_STATE", None)

    inserted = backend_state.insert_building_document(
        "doc-001",
        "topology.txt",
        "AHU-01 serves kitchen and living room.",
        status="ready",
    )

    assert inserted["id"] == "doc-001"
    assert inserted["status"] == "ready"

    documents = backend_state.list_building_documents()
    assert len(documents) == 1
    assert documents[0]["filename"] == "topology.txt"
    assert documents[0]["status"] == "ready"

    prompt_documents = backend_state.get_all_building_document_texts()
    assert prompt_documents == [
        {
            "filename": "topology.txt",
            "content_text": "AHU-01 serves kitchen and living room.",
        }
    ]

    assert backend_state.delete_building_document("doc-001") is True
    assert backend_state.list_building_documents() == []
