from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import torch

from ml.models.arch import Model
from ml.tests.conftest import build_small_dataset, build_train_config, repo_root


def test_conv1d_autoencoder_preserves_shape():
    model = Model(
        model_type="conv1d_autoencoder",
        input_channels=8,
        hidden_dim=16,
        latent_dim=8,
    )
    inputs = torch.randn(4, 8, 32)
    outputs = model(inputs)
    assert outputs.shape == inputs.shape


def test_conv1d_classifier_output_shape():
    model = Model(
        model_type="conv1d_classifier",
        input_channels=8,
        hidden_dim=16,
        num_classes=5,
    )
    inputs = torch.randn(4, 8, 32)
    outputs = model(inputs)
    assert outputs.shape == (4, 5)


def test_train_modes_smoke(tmp_path):
    built = build_small_dataset(tmp_path / "data")
    train_config_path = build_train_config(tmp_path / "cfg")
    dataset_path = Path(built["dataset_path"])
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=True)

    cases = [
        ("binary", "logreg", artifact_dir / "logreg_binary.pkl"),
        ("multiclass", "xgboost", artifact_dir / "xgboost_multiclass.pkl"),
        ("multiclass", "mlp_classifier", artifact_dir / "mlp_multiclass.pt"),
        ("binary", "conv1d_classifier", artifact_dir / "conv1d_binary.pt"),
        ("autoencoder", "conv1d_autoencoder", artifact_dir / "autoencoder.pt"),
    ]

    for task, model_type, weight_path in cases:
        command = [
            sys.executable,
            "-m",
            "ml.models.train",
            "--config",
            str(train_config_path),
            "--dataset",
            str(dataset_path),
            "--task",
            task,
            "--model",
            model_type,
            "--weights",
            str(weight_path),
        ]
        subprocess.run(command, cwd=repo_root(), check=True)
        assert weight_path.exists()

        metrics_path = artifact_dir / f"{weight_path.stem}_metrics.json"
        assert metrics_path.exists()
        with open(metrics_path, "r", encoding="utf-8") as handle:
            metrics = json.load(handle)
        assert metrics["model_type"] == model_type
        assert "test" in metrics["splits"]
