"""Aggregated telemetry profile generator.

Reads the collected anomaly dataset, builds phase-averaged profiles per
anomaly class, then walks them in a loop publishing synthetic ingest
payloads to the backend.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

import numpy as np
import pandas as pd

# -- constants ----------------------------------------------------------------

DATASET_CANDIDATES = [
    "ml/data/anomaly_dataset.csv",
    "ml/data/processed/anomaly_dataset.csv",
]

TELEMETRY_COLS = [
    "feedback_position_%",
    "setpoint_position_%",
    "motor_torque_Nmm",
    "internal_temperature_deg_C",
    "power_W",
]
CATEGORICAL_COL = "rotation_direction"

FIELD_MAP = {
    "feedback_position_%": "position_percent",
    "setpoint_position_%": "setpoint_position_percent",
    "motor_torque_Nmm": "torque",
    "internal_temperature_deg_C": "temperature",
    "power_W": "power_w",
    "rotation_direction": "rotation_direction",
}

CLASS_ORDER = ["normal", "stabbing", "bottle_stuck", "gear_stuck", "resistance"]

PHASE_BINS = 120
DEFAULT_NODE_ID = "BEL-VLV-003"
DEFAULT_DEVICE_TYPE = "valve"
DEFAULT_PARENT_IDS = ["ahu-01"]
DEFAULT_SPEED = 1.0
DEFAULT_BACKEND_URL = "http://backend-fastapi:5000"
DEFAULT_TICK_MS = 50  # base tick period at speed 1.0


# -- dataset loading ----------------------------------------------------------


def find_dataset(explicit: str | None = None) -> Path:
    if explicit:
        p = Path(explicit)
        if p.exists():
            return p

    for candidate in DATASET_CANDIDATES:
        for base in [Path.cwd(), Path(__file__).resolve().parents[1]]:
            p = base / candidate
            if p.exists():
                return p

    raise FileNotFoundError(f"Dataset not found. Tried: {DATASET_CANDIDATES}")


def load_dataset(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["_time"] = pd.to_datetime(df["_time"], utc=True, errors="coerce")
    df = df.dropna(subset=["_time"])
    needed = TELEMETRY_COLS + [CATEGORICAL_COL, "anomaly_type", "source_file"]
    for col in needed:
        if col not in df.columns:
            raise ValueError(f"Missing column: {col}")
    for col in TELEMETRY_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df[CATEGORICAL_COL] = (
        pd.to_numeric(df[CATEGORICAL_COL], errors="coerce").fillna(0).astype(int)
    )
    return df


# -- profile building --------------------------------------------------------


def _normalize_phase(group: pd.DataFrame) -> pd.DataFrame:
    """Map each recording group to phase [0, 1)."""
    g = group.sort_values("_time").copy()
    t = g["_time"].astype("int64")
    t_min, t_max = t.min(), t.max()
    span = t_max - t_min
    if span <= 0:
        g["_phase"] = 0.0
    else:
        g["_phase"] = (t - t_min) / span
    return g


def build_profiles(df: pd.DataFrame) -> dict[str, np.ndarray]:
    """Build phase-averaged profiles per anomaly class.

    Returns dict mapping class name to ndarray of shape (PHASE_BINS, n_features).
    Feature order: TELEMETRY_COLS + [CATEGORICAL_COL].
    """
    all_cols = TELEMETRY_COLS + [CATEGORICAL_COL]
    profiles: dict[str, np.ndarray] = {}

    for cls in CLASS_ORDER:
        subset = df[df["anomaly_type"] == cls]
        if subset.empty:
            continue

        bins_accum = np.zeros((PHASE_BINS, len(all_cols)), dtype=np.float64)
        bins_count = np.zeros(PHASE_BINS, dtype=np.float64)

        for _, group in subset.groupby("source_file"):
            g = _normalize_phase(group)
            bin_idx = np.clip(
                (g["_phase"].values * PHASE_BINS).astype(int), 0, PHASE_BINS - 1
            )
            values = g[all_cols].values.astype(np.float64)
            for i in range(len(g)):
                b = bin_idx[i]
                if not np.any(np.isnan(values[i])):
                    bins_accum[b] += values[i]
                    bins_count[b] += 1.0

        # average; fill empty bins with nearest neighbor
        mask = bins_count > 0
        bins_accum[mask] /= bins_count[mask, np.newaxis]

        profile = bins_accum.copy()
        for i in range(PHASE_BINS):
            if not mask[i]:
                # find nearest filled bin
                nearest = -1
                for d in range(1, PHASE_BINS):
                    if i - d >= 0 and mask[i - d]:
                        nearest = i - d
                        break
                    if i + d < PHASE_BINS and mask[i + d]:
                        nearest = i + d
                        break
                if nearest >= 0:
                    profile[i] = profile[nearest]

        # round rotation_direction to nearest int
        profile[:, -1] = np.clip(np.round(profile[:, -1]), 0, 2)

        profiles[cls] = profile

    return profiles


# -- noise injection ----------------------------------------------------------


def add_noise(row: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Add small gaussian noise to continuous features, leave categorical."""
    out = row.copy()
    for i in range(len(TELEMETRY_COLS)):
        scale = max(abs(out[i]) * 0.02, 0.01)
        out[i] += rng.normal(0.0, scale)
    # clamp position/power to non-negative
    out[0] = max(0.0, min(100.0, out[0]))  # feedback_position_%
    out[1] = max(0.0, min(100.0, out[1]))  # setpoint_position_%
    out[4] = max(0.0, out[4])  # power_W
    # rotation_direction stays as-is (already rounded int)
    return out


# -- payload ------------------------------------------------------------------


def row_to_payload(
    row: np.ndarray,
    node_id: str,
    device_type: str,
    parent_ids: list[str],
) -> dict[str, Any]:
    all_cols = TELEMETRY_COLS + [CATEGORICAL_COL]
    telemetry = {}
    for i, col in enumerate(all_cols):
        mapped = FIELD_MAP[col]
        telemetry[mapped] = round(float(row[i]), 4)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "nodeId": node_id,
        "timestamp": now.isoformat().replace("+00:00", "Z"),
        "deviceType": device_type,
        "parentIds": parent_ids,
        "telemetry": telemetry,
    }


# -- publishing ---------------------------------------------------------------


def post_ingest(backend_url: str, payload: dict[str, Any]) -> bool:
    url = f"{backend_url.rstrip('/')}/api/ingest"
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except (error.URLError, error.HTTPError, TimeoutError):
        return False


def wait_for_backend(backend_url: str, timeout: int = 60) -> None:
    health_url = f"{backend_url.rstrip('/')}/health"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            req = request.Request(health_url, method="GET")
            with request.urlopen(req, timeout=3):
                return
        except Exception:
            time.sleep(2)
    print(
        f"[simulator] backend not reachable at {health_url} after {timeout}s",
        file=sys.stderr,
    )
    sys.exit(1)


# -- main loop ----------------------------------------------------------------


def run(
    dataset_path: str | None = None,
    backend_url: str | None = None,
    node_id: str | None = None,
    device_type: str | None = None,
    parent_ids: list[str] | None = None,
    speed: float | None = None,
    loop: bool = True,
) -> None:
    backend = backend_url or os.getenv("SIM_BACKEND_URL", DEFAULT_BACKEND_URL)
    nid = node_id or os.getenv("SIM_NODE_ID", DEFAULT_NODE_ID)
    dtype = device_type or os.getenv("SIM_DEVICE_TYPE", DEFAULT_DEVICE_TYPE)
    pids = parent_ids or os.getenv(
        "SIM_PARENT_IDS", ",".join(DEFAULT_PARENT_IDS)
    ).split(",")
    spd = speed or float(os.getenv("SIM_SPEED", str(DEFAULT_SPEED)))
    do_loop = loop if not os.getenv("SIM_LOOP") else os.getenv("SIM_LOOP", "1") == "1"

    path = find_dataset(dataset_path or os.getenv("SIM_DATASET_PATH"))
    print(f"[simulator] dataset: {path}")
    print(f"[simulator] backend: {backend}")
    print(f"[simulator] node: {nid} ({dtype}) parents={pids}")
    print(f"[simulator] speed: {spd}x  loop: {do_loop}")

    df = load_dataset(path)
    profiles = build_profiles(df)
    if not profiles:
        print("[simulator] no profiles built, exiting", file=sys.stderr)
        sys.exit(1)

    print(f"[simulator] profiles: {list(profiles.keys())}")

    wait_for_backend(backend)
    print("[simulator] backend ready, starting publish loop")

    rng = np.random.default_rng(42)
    tick_s = (DEFAULT_TICK_MS / 1000.0) / max(0.1, spd)
    published = 0
    errors = 0

    try:
        while True:
            for cls in CLASS_ORDER:
                profile = profiles.get(cls)
                if profile is None:
                    continue
                for step in range(PHASE_BINS):
                    row = add_noise(profile[step], rng)
                    payload = row_to_payload(row, nid, dtype, pids)
                    ok = post_ingest(backend, payload)
                    if ok:
                        published += 1
                    else:
                        errors += 1
                    if published % 50 == 0:
                        print(
                            f"[simulator] published={published} errors={errors} "
                            f"class={cls} step={step}/{PHASE_BINS}"
                        )
                    time.sleep(tick_s)
            if not do_loop:
                break
    except KeyboardInterrupt:
        pass

    print(f"[simulator] done. published={published} errors={errors}")
