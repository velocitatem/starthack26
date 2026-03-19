from __future__ import annotations

import math

import pandas as pd

from ml.tests.conftest import build_small_dataset


def test_synthetic_etl_is_deterministic(tmp_path):
    first = build_small_dataset(tmp_path / "first", seed=19)
    second = build_small_dataset(tmp_path / "second", seed=19)

    pd.testing.assert_frame_equal(
        first["frame"].reset_index(drop=True),
        second["frame"].reset_index(drop=True),
        check_dtype=False,
        check_like=False,
    )


def test_dataset_blob_schema_and_split_isolation(tmp_path):
    built = build_small_dataset(tmp_path)
    dataset_blob = built["dataset_blob"]
    frame = built["frame"]

    expected_columns = {
        "_time",
        "_measurement",
        "feedback_position_%",
        "internal_temperature_deg_C",
        "motor_torque_Nmm",
        "power_W",
        "pipe_air_flow_Lpm",
        "pipe_air_temperature_deg_C",
        "pipe_air_flow_ema_8",
        "pipe_air_temperature_ema_8",
        "rotation_direction",
        "setpoint_position_%",
        "test_number",
        "recording_event",
        "anomaly_type",
        "is_anomaly",
        "source_file",
        "run_id",
        "severity",
        "synthetic_seed",
        "scenario_profile",
        "split",
        "position_error_pct",
        "time_delta_s",
        "effective_step_s",
        "velocity_pct_per_s",
    }
    assert expected_columns.issubset(frame.columns)

    assert dataset_blob["sequence_windows"].ndim == 3
    assert dataset_blob["tabular_features"].ndim == 2
    assert dataset_blob["sequence_windows"].shape[0] == dataset_blob["tabular_features"].shape[0]
    assert len(dataset_blob["feature_names"]) == dataset_blob["sequence_windows"].shape[2]
    assert len(dataset_blob["tabular_feature_names"]) == dataset_blob["tabular_features"].shape[1]

    split_runs = {}
    for split_name, indices in dataset_blob["split_indices"].items():
        split_runs[split_name] = {dataset_blob["run_ids"][index] for index in indices.tolist()}
        assert split_runs[split_name]

    assert split_runs["train"].isdisjoint(split_runs["val"])
    assert split_runs["train"].isdisjoint(split_runs["test"])
    assert split_runs["val"].isdisjoint(split_runs["test"])


def test_class_physics_and_realism_report(tmp_path):
    built = build_small_dataset(tmp_path, seed=23)
    frame = built["frame"].copy()
    frame["abs_velocity"] = frame["velocity_pct_per_s"].abs()
    frame["abs_torque"] = frame["motor_torque_Nmm"].abs()
    frame["abs_position_error"] = (
        frame["setpoint_position_%"] - frame["feedback_position_%"]
    ).abs()
    frame["air_temp_delta"] = (
        frame["pipe_air_temperature_deg_C"] - frame["internal_temperature_deg_C"]
    )
    frame["power_step_change"] = (
        frame.groupby("run_id")["power_W"].diff().abs().fillna(0.0)
    )

    summary = frame.groupby("anomaly_type").agg(
        mean_power=("power_W", "mean"),
        mean_abs_velocity=("abs_velocity", "mean"),
        mean_abs_torque=("abs_torque", "mean"),
        mean_abs_error=("abs_position_error", "mean"),
        mean_power_step_change=("power_step_change", "mean"),
        mean_pipe_air_flow=("pipe_air_flow_Lpm", "mean"),
        mean_air_temp_delta=("air_temp_delta", "mean"),
    )
    closing = frame[frame["rotation_direction"] == 0].groupby("anomaly_type")[
        "abs_position_error"
    ].median()
    active_closing = frame[
        (frame["rotation_direction"] == 0) & (frame.get("anomaly_event_level", 0.0) > 0.18)
    ].groupby("anomaly_type")["abs_position_error"].median()
    active_power_step_change = frame[
        frame.get("anomaly_event_level", 0.0) > 0.18
    ].groupby("anomaly_type")["power_step_change"].mean()

    assert summary.loc["gear_stuck", "mean_abs_velocity"] < summary.loc["normal", "mean_abs_velocity"] * 0.80
    assert summary.loc["gear_stuck", "mean_power"] < summary.loc["normal", "mean_power"] * 0.85
    assert active_closing.loc["bottle_stuck"] > closing.loc["normal"] * 0.60
    assert summary.loc["resistance", "mean_abs_torque"] > summary.loc["normal", "mean_abs_torque"]
    assert active_power_step_change.loc["stabbing"] > summary.loc["normal", "mean_power_step_change"] * 0.95
    assert summary.loc["gear_stuck", "mean_pipe_air_flow"] < summary.loc["normal", "mean_pipe_air_flow"]
    assert summary.loc["resistance", "mean_air_temp_delta"] > summary.loc["normal", "mean_air_temp_delta"] - 0.5

    report = built["realism_report"]
    assert math.isfinite(report["mmd_rbf"])
    assert math.isfinite(report["pca_gap_l2"])
    assert report["synthetic"]["participation_ratio"] > 0.0
    assert 0.0 <= report["neighborhood_mixing"]["real_to_synthetic"] <= 1.0
    assert 0.0 <= report["neighborhood_mixing"]["synthetic_to_real"] <= 1.0
