from __future__ import annotations

from pathlib import Path

import yaml

from ml.data.etl import (
    build_calibration_reference,
    build_dataset_blob,
    build_synthetic_frame,
    load_config,
    parse_real_dataframe,
    resolve_real_data_path,
    write_outputs,
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def build_small_dataset(tmp_path: Path, seed: int = 11) -> dict[str, object]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    output_dir = tmp_path / "processed"
    data_config_path = tmp_path / "data.yaml"
    config_payload = {
        "dataset_name": "synthetic_actuator_test_dataset",
        "output_dir": str(output_dir),
        "real_data_path": str(repo_root() / "ml/data/anomaly_dataset.csv"),
        "synthetic_csv_name": "synthetic_anomaly_dataset.csv",
        "realism_report_name": "realism_report.json",
        "metadata_name": "metadata.json",
        "seed": seed,
        "simulation": {
            "runs_per_class": 6,
            "min_steps": 80,
            "max_steps": 112,
            "timestep_ms_min": 40.0,
            "timestep_ms_max": 60.0,
            "severity_min": 0.2,
            "severity_max": 1.0,
        },
        "splits": {"train": 0.5, "val": 0.25, "test": 0.25},
        "windows": {"size": 32, "stride": 16},
        "calibration": {
            "enabled": True,
            "latent_dim": 3,
            "knn_k": 3,
            "max_report_samples": 128,
        },
    }
    data_config_path.write_text(yaml.safe_dump(config_payload), encoding="utf-8")

    config = load_config(str(data_config_path))
    real_frame = parse_real_dataframe(resolve_real_data_path(config.real_data_path))
    reference = build_calibration_reference(real_frame, config)
    synthetic_frame = build_synthetic_frame(config, reference)
    dataset_blob, metadata, realism_report = build_dataset_blob(
        synthetic_frame, reference, config
    )
    write_outputs(
        output_dir=output_dir,
        synthetic_frame=synthetic_frame,
        dataset_blob=dataset_blob,
        metadata=metadata,
        realism_report=realism_report,
        config=config,
    )
    return {
        "config": config,
        "frame": synthetic_frame,
        "dataset_blob": dataset_blob,
        "metadata": metadata,
        "realism_report": realism_report,
        "output_dir": output_dir,
        "dataset_path": output_dir / "dataset.pt",
        "csv_path": output_dir / "synthetic_anomaly_dataset.csv",
    }


def build_train_config(tmp_path: Path) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    train_config_path = tmp_path / "train.yaml"
    config_payload = {
        "task": "multiclass",
        "model_type": "mlp_classifier",
        "seed": 11,
        "device": "cpu",
        "tensorboard_dir": str(tmp_path / "tensorboard"),
        "artifact_dir": str(tmp_path / "artifacts"),
        "log_every_n_steps": 5,
        "classification": {
            "batch_size": 16,
            "epochs": 2,
            "learning_rate": 0.001,
            "hidden_dim": 32,
            "dropout": 0.1,
        },
        "logistic_regression": {
            "max_iter": 200,
            "c": 1.0,
            "class_weight": "balanced",
        },
        "xgboost": {
            "n_estimators": 12,
            "max_depth": 3,
            "learning_rate": 0.15,
            "subsample": 0.9,
            "colsample_bytree": 0.9,
            "reg_lambda": 1.0,
            "n_jobs": 1,
        },
        "autoencoder": {
            "batch_size": 16,
            "epochs": 2,
            "learning_rate": 0.001,
            "hidden_dim": 16,
            "latent_dim": 8,
            "threshold_percentile": 90.0,
        },
    }
    train_config_path.write_text(yaml.safe_dump(config_payload), encoding="utf-8")
    return train_config_path
