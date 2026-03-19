from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone

import shacklib.ml_diagnosis as ml_diagnosis
from shacklib.mock_facility import build_seed_state


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def test_collect_diagnoses_skips_seeded_nodes_without_ingest(monkeypatch):
    state = build_seed_state()
    called = {"count": 0}

    def _fake_infer(*_args, **_kwargs):
        called["count"] += 1
        return {"diagnosis": None}

    monkeypatch.setattr(ml_diagnosis, "infer_failure_mode_for_node", _fake_infer)

    diagnoses, stats = ml_diagnosis.collect_diagnoses(state)

    assert diagnoses == {}
    assert stats["mlPredictions"] == 0
    assert stats["fallbackPredictions"] == 0
    assert stats["skippedNodes"] >= 1
    assert called["count"] == 0


def test_collect_diagnoses_only_targets_fresh_nodes(monkeypatch):
    state = build_seed_state()
    now_iso = _utc_now_iso()
    state["meta"]["lastIngestAt"] = now_iso
    state["nodes"]["BEL-VNT-003"]["updatedAt"] = now_iso

    called_node_ids: list[str] = []

    def _fake_infer(node_payload, **_kwargs):
        called_node_ids.append(str(node_payload.get("id")))
        return {
            "diagnosis": {
                "status": "critical",
                "kind": "gear_jam_transmission_lock",
                "probability": 0.93,
                "summary": "Transmission lock pattern detected.",
                "recommendedAction": "Inspect gearbox.",
            }
        }

    monkeypatch.setattr(ml_diagnosis, "infer_failure_mode_for_node", _fake_infer)

    diagnoses, stats = ml_diagnosis.collect_diagnoses(state)

    assert set(diagnoses.keys()) == {"BEL-VNT-003"}
    assert called_node_ids == ["BEL-VNT-003"]
    assert stats["mlPredictions"] == 1


def test_apply_diagnoses_with_empty_lookup_is_noop_for_nodes():
    state = build_seed_state()
    before = deepcopy(state)

    summary = ml_diagnosis.apply_diagnoses(state, {})

    assert summary["processedNodes"] == 0
    assert state["nodes"] == before["nodes"]
    assert state["faults"] == before["faults"]
