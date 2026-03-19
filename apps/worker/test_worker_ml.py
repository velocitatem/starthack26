from __future__ import annotations

import sys
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER_DIR = ROOT / "apps" / "worker"

for path in (str(ROOT), str(WORKER_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

import worker  # noqa: E402
from shacklib.mock_datacenter import build_seed_state  # noqa: E402


def test_run_classification_uses_ml_failure_modes(monkeypatch):
    snapshot = build_seed_state()
    live_state = deepcopy(snapshot)

    monkeypatch.setattr(worker, "read_state", lambda: deepcopy(snapshot))

    diagnoses = {
        node_id: None
        for node_id, node in snapshot["nodes"].items()
        if node.get("latestTelemetry")
    }
    diagnoses["BEL-VLV-003"] = {
        "status": "critical",
        "kind": "gear_jam_transmission_lock",
        "probability": 0.93,
        "summary": "ML detected transmission lock pattern.",
        "recommendedAction": "Inspect actuator gearbox and coupling.",
    }

    monkeypatch.setattr(
        worker,
        "collect_diagnoses",
        lambda _snapshot: (
            diagnoses,
            {
                "mlPredictions": len(diagnoses),
                "fallbackPredictions": 0,
                "mlErrors": 0,
            },
        ),
    )
    monkeypatch.setattr(worker, "update_state", lambda mutator: mutator(live_state))

    summary = worker.run_classification()

    assert summary["mlPredictions"] > 0
    assert summary["fallbackPredictions"] == 0

    node = live_state["nodes"]["BEL-VLV-003"]
    assert node["status"] == "critical"
    assert isinstance(node.get("latestFaultId"), str)

    fault = live_state["faults"][node["latestFaultId"]]
    assert fault["kind"] == "gear_jam_transmission_lock"


def test_run_classification_falls_back_when_ml_unavailable(monkeypatch):
    snapshot = build_seed_state()
    live_state = deepcopy(snapshot)

    monkeypatch.setattr(worker, "read_state", lambda: deepcopy(snapshot))
    monkeypatch.setattr(
        worker,
        "collect_diagnoses",
        lambda _snapshot: (
            {},
            {
                "mlPredictions": 0,
                "fallbackPredictions": 10,
                "mlErrors": 10,
            },
        ),
    )
    monkeypatch.setattr(worker, "update_state", lambda mutator: mutator(live_state))

    summary = worker.run_classification()

    assert summary["fallbackPredictions"] > 0
    assert summary["mlErrors"] == summary["fallbackPredictions"]
