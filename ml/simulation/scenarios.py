from __future__ import annotations

from dataclasses import dataclass

from ml.simulation.engine import SimulationEngine, SimulationResult
from ml.simulation.kernels.airflow import AirflowPropagationKernel
from ml.simulation.kernels.cascade import CascadePropagationKernel
from ml.simulation.kernels.control import HVACControlKernel
from ml.simulation.kernels.failure import FailureInjectionKernel
from ml.simulation.kernels.thermal import ThermalPropagationKernel
from ml.simulation.state import FailureEvent, SimulationState
from ml.simulation.topology import (
    DatacenterTopology,
    build_datacenter_topology,
    build_initial_state,
)


@dataclass(slots=True)
class ScenarioDefinition:
    name: str
    description: str
    duration_s: float
    failures: list[FailureEvent]


def build_default_engine(topology: DatacenterTopology) -> SimulationEngine:
    kernels = [
        HVACControlKernel(topology),
        FailureInjectionKernel(),
        AirflowPropagationKernel(topology),
        ThermalPropagationKernel(),
        CascadePropagationKernel(),
    ]
    return SimulationEngine(kernels=kernels)


def default_scenarios(duration_s: float = 900.0) -> dict[str, ScenarioDefinition]:
    return {
        "baseline": ScenarioDefinition(
            name="baseline",
            description="All components healthy",
            duration_s=duration_s,
            failures=[],
        ),
        "dmp_ef_stuck": ScenarioDefinition(
            name="dmp_ef_stuck",
            description="Row E/F exhaust dampener stuck closed",
            duration_s=duration_s,
            failures=[FailureEvent(component_id="dmp_ef", mode="stuck", severity=0.95)],
        ),
        "compound_ef_cd": ScenarioDefinition(
            name="compound_ef_cd",
            description="E/F exhaust dampener stuck and C/D supply dampener jammed",
            duration_s=duration_s,
            failures=[
                FailureEvent(component_id="dmp_ef", mode="stuck", severity=0.95),
                FailureEvent(
                    component_id="vlv_cd",
                    mode="gear_stuck",
                    severity=0.80,
                    start_s=120.0,
                ),
            ],
        ),
        "intake_resistance": ScenarioDefinition(
            name="intake_resistance",
            description="Intake dampener develops added mechanical resistance",
            duration_s=duration_s,
            failures=[
                FailureEvent(
                    component_id="act_intake",
                    mode="added_mechanical_resistance",
                    severity=0.75,
                )
            ],
        ),
    }


def run_scenario(
    scenario: ScenarioDefinition,
    *,
    topology: DatacenterTopology | None = None,
    initial_state: SimulationState | None = None,
) -> SimulationResult:
    topology = topology or build_datacenter_topology()
    state = initial_state or build_initial_state(topology)
    engine = build_default_engine(topology)
    return engine.run_scenario(
        state,
        scenario_name=scenario.name,
        duration_s=scenario.duration_s,
        failures=scenario.failures,
    )


def discovery_report(
    baseline: SimulationResult,
    candidate: SimulationResult,
    *,
    focus_zone_id: str = "zone_ef",
) -> dict[str, float | str | None]:
    zone_peak_delta_by_zone = {
        zone_id: round(
            candidate.peak_zone_temp_c(zone_id) - baseline.peak_zone_temp_c(zone_id),
            3,
        )
        for zone_id in baseline.zone_avg_temp_c.keys()
    }
    most_impacted_zone_id = max(
        zone_peak_delta_by_zone,
        key=lambda zone_id: zone_peak_delta_by_zone[zone_id],
    )
    baseline_peak = baseline.peak_zone_temp_c(focus_zone_id)
    candidate_peak = candidate.peak_zone_temp_c(focus_zone_id)
    baseline_cpu_peak = max(baseline.max_cpu_temp_c) if baseline.max_cpu_temp_c else 0.0
    candidate_cpu_peak = (
        max(candidate.max_cpu_temp_c) if candidate.max_cpu_temp_c else 0.0
    )
    return {
        "focus_zone_id": focus_zone_id,
        "zone_peak_delta_by_zone": zone_peak_delta_by_zone,
        "most_impacted_zone_id": most_impacted_zone_id,
        "max_zone_peak_delta_c": zone_peak_delta_by_zone[most_impacted_zone_id],
        "baseline_zone_peak_c": round(baseline_peak, 3),
        "candidate_zone_peak_c": round(candidate_peak, 3),
        "zone_peak_delta_c": round(candidate_peak - baseline_peak, 3),
        "baseline_cpu_peak_c": round(baseline_cpu_peak, 3),
        "candidate_cpu_peak_c": round(candidate_cpu_peak, 3),
        "cpu_peak_delta_c": round(candidate_cpu_peak - baseline_cpu_peak, 3),
        "time_to_first_throttle_baseline_s": _time_to_first_count(
            baseline.times_s,
            baseline.throttled_cpu_count,
        ),
        "time_to_first_throttle_candidate_s": _time_to_first_count(
            candidate.times_s,
            candidate.throttled_cpu_count,
        ),
        "time_to_first_shutdown_baseline_s": _time_to_first_count(
            baseline.times_s,
            baseline.shutdown_cpu_count,
        ),
        "time_to_first_shutdown_candidate_s": _time_to_first_count(
            candidate.times_s,
            candidate.shutdown_cpu_count,
        ),
    }


def _time_to_first_count(times_s: list[float], count_series: list[int]) -> float | None:
    for time_s, count in zip(times_s, count_series):
        if count > 0:
            return float(time_s)
    return None
