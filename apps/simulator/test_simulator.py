from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for p in (str(ROOT),):
    if p not in sys.path:
        sys.path.insert(0, p)

import numpy as np
from shacklib.node_simulator import (
    CATEGORICAL_COL,
    CLASS_ORDER,
    FIELD_MAP,
    PHASE_BINS,
    TELEMETRY_COLS,
    add_noise,
    build_profiles,
    load_dataset,
    row_to_payload,
)


DATASET_PATH = ROOT / "ml" / "data" / "anomaly_dataset.csv"


def _load():
    return load_dataset(DATASET_PATH)


def test_load_dataset_returns_expected_columns():
    df = _load()
    for col in TELEMETRY_COLS + [CATEGORICAL_COL, "anomaly_type", "source_file"]:
        assert col in df.columns, f"Missing column: {col}"
    assert len(df) > 100


def test_build_profiles_shape_and_classes():
    df = _load()
    profiles = build_profiles(df)
    n_features = len(TELEMETRY_COLS) + 1  # +1 for categorical
    for cls in CLASS_ORDER:
        if cls not in profiles:
            continue
        profile = profiles[cls]
        assert profile.shape == (PHASE_BINS, n_features), (
            f"class={cls} shape={profile.shape}"
        )
        # rotation_direction should be 0, 1, or 2
        assert np.all(profile[:, -1] >= 0)
        assert np.all(profile[:, -1] <= 2)


def test_profiles_are_not_raw_replay():
    """Profiles should be aggregated averages, not identical to any single row."""
    df = _load()
    profiles = build_profiles(df)
    # pick any class with data
    for cls, profile in profiles.items():
        subset = df[df["anomaly_type"] == cls]
        all_cols = TELEMETRY_COLS + [CATEGORICAL_COL]
        raw_rows = subset[all_cols].values
        # no profile row should exactly match any raw row
        for step in range(PHASE_BINS):
            matches = np.all(np.isclose(raw_rows, profile[step], atol=1e-8), axis=1)
            assert not np.any(matches), f"Profile step {step} matches a raw row exactly"
        break  # one class is enough


def test_add_noise_changes_continuous_preserves_bounds():
    rng = np.random.default_rng(99)
    row = np.array([50.0, 60.0, -0.5, 27.0, 0.3, 1.0])
    noisy = add_noise(row, rng)
    # continuous fields should differ
    assert not np.allclose(row[:5], noisy[:5])
    # position clamped to [0, 100]
    assert 0.0 <= noisy[0] <= 100.0
    assert 0.0 <= noisy[1] <= 100.0
    # power non-negative
    assert noisy[4] >= 0.0


def test_row_to_payload_maps_fields():
    row = np.array([55.0, 60.0, -0.8, 27.2, 0.15, 1.0])
    payload = row_to_payload(row, "TEST-001", "valve", ["ahu-01"])
    assert payload["nodeId"] == "TEST-001"
    assert payload["deviceType"] == "valve"
    assert payload["parentIds"] == ["ahu-01"]
    assert "timestamp" in payload
    tel = payload["telemetry"]
    assert tel["position_percent"] == 55.0
    assert tel["setpoint_position_percent"] == 60.0
    assert tel["torque"] == -0.8
    assert tel["temperature"] == 27.2
    assert tel["power_w"] == 0.15
    assert tel["rotation_direction"] == 1.0
    # all mapped fields present
    for mapped in FIELD_MAP.values():
        assert mapped in tel, f"Missing mapped field: {mapped}"
