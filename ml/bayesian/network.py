from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BayesianNode:
    id: str
    label: str
    layer: str
    kind: str


@dataclass(frozen=True, slots=True)
class BayesianEdge:
    source: str
    target: str
    weight: float


@dataclass(slots=True)
class BayesianGraph:
    nodes: list[BayesianNode]
    edges: list[BayesianEdge]


def build_datacenter_bayesian_graph() -> BayesianGraph:
    nodes = [
        BayesianNode(
            id="f_act_intake",
            label="Intake dampener failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="f_vlv_ab",
            label="Supply dampener AB failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="f_vlv_cd",
            label="Supply dampener CD failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="f_act_ef_supply",
            label="Supply dampener EF failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="f_dmp_ab",
            label="Exhaust dampener AB failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="f_act_cd_exhaust",
            label="Exhaust dampener CD failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="f_dmp_ef",
            label="Exhaust dampener EF failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="f_dmp_outlet",
            label="Main outlet dampener failure",
            layer="components",
            kind="component_failure",
        ),
        BayesianNode(
            id="r_supply_ab", label="Supply deficit AB", layer="flow", kind="flow_risk"
        ),
        BayesianNode(
            id="r_supply_cd", label="Supply deficit CD", layer="flow", kind="flow_risk"
        ),
        BayesianNode(
            id="r_supply_ef", label="Supply deficit EF", layer="flow", kind="flow_risk"
        ),
        BayesianNode(
            id="r_exhaust_ab",
            label="Exhaust blockage AB",
            layer="flow",
            kind="flow_risk",
        ),
        BayesianNode(
            id="r_exhaust_cd",
            label="Exhaust blockage CD",
            layer="flow",
            kind="flow_risk",
        ),
        BayesianNode(
            id="r_exhaust_ef",
            label="Exhaust blockage EF",
            layer="flow",
            kind="flow_risk",
        ),
        BayesianNode(
            id="r_zone_ab", label="Zone AB overtemp", layer="zone", kind="thermal_risk"
        ),
        BayesianNode(
            id="r_zone_cd", label="Zone CD overtemp", layer="zone", kind="thermal_risk"
        ),
        BayesianNode(
            id="r_zone_ef", label="Zone EF overtemp", layer="zone", kind="thermal_risk"
        ),
        BayesianNode(
            id="r_cpu",
            label="CPU throttling risk",
            layer="equipment",
            kind="equipment_risk",
        ),
        BayesianNode(
            id="r_service",
            label="Service degradation risk",
            layer="system",
            kind="system_risk",
        ),
    ]

    edges = [
        BayesianEdge(source="f_act_intake", target="r_supply_ab", weight=0.44),
        BayesianEdge(source="f_act_intake", target="r_supply_cd", weight=0.44),
        BayesianEdge(source="f_act_intake", target="r_supply_ef", weight=0.44),
        BayesianEdge(source="f_vlv_ab", target="r_supply_ab", weight=0.88),
        BayesianEdge(source="f_vlv_cd", target="r_supply_cd", weight=0.88),
        BayesianEdge(source="f_act_ef_supply", target="r_supply_ef", weight=0.88),
        BayesianEdge(source="f_dmp_ab", target="r_exhaust_ab", weight=0.9),
        BayesianEdge(source="f_act_cd_exhaust", target="r_exhaust_cd", weight=0.9),
        BayesianEdge(source="f_dmp_ef", target="r_exhaust_ef", weight=0.9),
        BayesianEdge(source="f_dmp_outlet", target="r_exhaust_ab", weight=0.42),
        BayesianEdge(source="f_dmp_outlet", target="r_exhaust_cd", weight=0.42),
        BayesianEdge(source="f_dmp_outlet", target="r_exhaust_ef", weight=0.42),
        BayesianEdge(source="r_supply_ab", target="r_zone_ab", weight=0.76),
        BayesianEdge(source="r_exhaust_ab", target="r_zone_ab", weight=0.76),
        BayesianEdge(source="r_supply_cd", target="r_zone_cd", weight=0.76),
        BayesianEdge(source="r_exhaust_cd", target="r_zone_cd", weight=0.76),
        BayesianEdge(source="r_supply_ef", target="r_zone_ef", weight=0.76),
        BayesianEdge(source="r_exhaust_ef", target="r_zone_ef", weight=0.76),
        BayesianEdge(source="r_zone_ab", target="r_cpu", weight=0.36),
        BayesianEdge(source="r_zone_cd", target="r_cpu", weight=0.36),
        BayesianEdge(source="r_zone_ef", target="r_cpu", weight=0.54),
        BayesianEdge(source="r_cpu", target="r_service", weight=0.78),
    ]

    return BayesianGraph(nodes=nodes, edges=edges)
