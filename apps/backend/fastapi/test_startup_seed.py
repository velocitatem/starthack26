from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FASTAPI_DIR = ROOT / "apps" / "backend" / "fastapi"

for path in (str(ROOT), str(FASTAPI_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from shacklib.state_seed import (  # noqa: E402
    StartupSeedConfig,
    build_startup_seed_state,
    seed_state_on_startup,
)


def _device_nodes(state: dict) -> list[dict]:
    nodes = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}
    return [
        node
        for node in nodes.values()
        if isinstance(node, dict) and str(node.get("type") or "") in {"dampener"}
    ]


def test_build_startup_seed_state_respects_node_count_and_ratios():
    config = StartupSeedConfig(
        mode="always",
        node_count=20,
        severe_ratio=0.10,
        moderate_ratio=0.10,
        random_seed=7,
        history_points=24,
        interval_minutes=5,
    )

    seeded = build_startup_seed_state(config)
    devices = _device_nodes(seeded)
    critical = sum(1 for node in devices if node.get("status") == "critical")
    warning = sum(1 for node in devices if node.get("status") == "warning")

    assert len(devices) == 20
    assert critical == 2
    assert warning == 2
    assert all(len(node["historyByVariable"]["torque"]) == 24 for node in devices)
    assert seeded["meta"]["seedSource"] == "mock"


def test_seed_state_on_startup_respects_if_empty_mode():
    state = {
        "nodes": {"legacy-node": {"id": "legacy-node", "type": "device"}},
        "faults": {},
        "catalog": {},
        "meta": {},
    }
    config = StartupSeedConfig(
        mode="if-empty",
        node_count=8,
        severe_ratio=0.10,
        moderate_ratio=0.10,
        random_seed=42,
        history_points=12,
        interval_minutes=5,
    )

    seeded = seed_state_on_startup(state, config=config)

    assert seeded is False
    assert "legacy-node" in state["nodes"]


def test_seed_state_on_startup_overwrites_existing_state_in_always_mode():
    state = {
        "nodes": {"legacy-node": {"id": "legacy-node", "type": "device"}},
        "faults": {},
        "catalog": {},
        "meta": {},
    }
    config = StartupSeedConfig(
        mode="always",
        node_count=8,
        severe_ratio=0.10,
        moderate_ratio=0.10,
        random_seed=42,
        history_points=12,
        interval_minutes=5,
    )

    seeded = seed_state_on_startup(state, config=config)
    devices = _device_nodes(state)

    assert seeded is True
    assert "legacy-node" not in state["nodes"]
    assert len(devices) == 8
    assert state["meta"]["seededAt"] is not None
