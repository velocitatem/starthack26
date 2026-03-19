from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

NodeStatus = Literal["healthy", "warning", "critical", "offline"]
DeviceStatus = Literal["healthy", "warning", "fault", "offline"]
FaultState = Literal["open", "resolved"]
DeviceType = Literal["dampener"]
AirflowDirection = Literal["supply", "return"] | None
FacilityNodeType = Literal["system", "ahu", "dampener", "device"]


class IngestPayload(BaseModel):
    nodeId: str = Field(min_length=1)
    timestamp: datetime
    deviceType: str = Field(min_length=1)
    parentIds: list[str] = Field(default_factory=list)
    telemetry: dict[str, Any] = Field(default_factory=dict)


class IngestResponse(BaseModel):
    ok: bool
    nodeId: str
    acceptedAt: str


class TelemetryPoint(BaseModel):
    time: str
    value: float


class FaultImpactMeta(BaseModel):
    estimatedImpact: str
    energyWaste: str


class LiveFaultView(BaseModel):
    id: str
    state: Literal["open"]
    kind: str
    probability: float
    summary: str
    recommendedAction: str


class LiveNodeView(BaseModel):
    id: str
    label: str
    type: FacilityNodeType
    status: NodeStatus
    position: float
    parentIds: list[str]
    fault: LiveFaultView | None = None


class FrontendFaultView(BaseModel):
    id: str
    type: str
    severity: Literal["critical", "high", "medium", "low"]
    diagnosis: str
    recommendation: str
    detectedAt: str
    estimatedImpact: str
    energyWaste: str


class DeviceView(BaseModel):
    id: str
    name: str
    model: str
    serial: str
    type: DeviceType
    zone: str
    zoneId: str
    status: DeviceStatus
    x: float
    y: float
    installedDate: str
    anomalyScore: float
    airflowDirection: AirflowDirection
    torque: list[TelemetryPoint]
    position: list[TelemetryPoint]
    temperature: list[TelemetryPoint]
    faults: list[FrontendFaultView]


class DeviceTemplateView(BaseModel):
    id: str
    name: str
    model: str
    serial: str
    type: DeviceType
    zone: str
    zoneId: str
    x: float
    y: float
    installedDate: str
    baseAnomalyScore: float
    airflowDirection: AirflowDirection
    torque: list[TelemetryPoint]
    position: list[TelemetryPoint]
    temperature: list[TelemetryPoint]


class ZoneView(BaseModel):
    id: str
    name: str
    label: str
    x: int
    y: int
    width: int
    height: int
    healthScore: int


class AHUUnitView(BaseModel):
    id: str
    label: str
    x: int
    y: int
    description: str


class BuildingStatsView(BaseModel):
    totalDevices: int
    healthyDevices: int
    warningDevices: int
    faultDevices: int
    overallHealth: float
    energyWaste: str
    estimatedCost: str
    activeFaults: int


class CatalogView(BaseModel):
    deviceTemplates: list[DeviceTemplateView]
    zones: list[ZoneView]
    ahuUnits: list[AHUUnitView]
    faultMetaByDeviceId: dict[str, FaultImpactMeta]


class DerivedView(BaseModel):
    devices: list[DeviceView]
    buildingStats: BuildingStatsView
    nodePositions: dict[str, float]


class MetaView(BaseModel):
    lastIngestAt: str | None = None
    lastClassificationAt: str | None = None
    lastFaultResolutionAt: str | None = None
    seedSource: Literal["mock"] | None = None
    seededAt: str | None = None


class StatusResponse(BaseModel):
    generatedAt: str
    nodes: list[LiveNodeView]
    catalog: CatalogView
    historyByNodeId: dict[str, dict[str, list[TelemetryPoint]]]
    derived: DerivedView
    meta: MetaView


class ResolveFaultRequest(BaseModel):
    resolvedBy: str = Field(min_length=1)
    note: str | None = None


class ResolveFaultResponse(BaseModel):
    ok: bool
    faultId: str
    state: FaultState


class NodeFaultHistoryEntry(BaseModel):
    id: str
    state: FaultState
    kind: str
    probability: float
    summary: str
    recommendedAction: str
    openedAt: str
    updatedAt: str
    resolvedBy: str | None = None
    note: str | None = None


class NodeFaultHistoryResponse(BaseModel):
    nodeId: str
    nodeLabel: str
    totalFaults: int
    openFaults: int
    faultHistory: list[NodeFaultHistoryEntry]


class MlFailureModeRequest(BaseModel):
    nodeId: str = Field(min_length=1)
    timeoutSeconds: float | None = Field(default=None, ge=0.2, le=30.0)


class MlFailureModeDiagnosis(BaseModel):
    status: NodeStatus
    kind: str
    probability: float
    summary: str
    recommendedAction: str


class MlFailureModeResponse(BaseModel):
    nodeId: str
    generatedAt: str
    mlUrl: str
    modelType: str | None = None
    task: str | None = None
    prediction: int | None = None
    className: str | None = None
    confidence: float | None = None
    diagnosis: MlFailureModeDiagnosis | None = None
    available: bool = True
    error: str | None = None


class DocumentListItem(BaseModel):
    id: str
    filename: str
    status: Literal["processing", "ready", "error"]
    errorMessage: str | None = None
    uploadedAt: str


class DocumentUploadResponse(DocumentListItem):
    pass


class AgentChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class AgentToolEvent(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    outcome: Literal["executed", "pending_approval", "error"]
    result: dict[str, Any] | None = None


class AgentPendingAction(BaseModel):
    id: str
    name: str
    summary: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class AgentChatRequest(BaseModel):
    messages: list[AgentChatMessage] = Field(default_factory=list)
    actor: str = Field(default="webapp-operator", min_length=1, max_length=64)
    pendingActionId: str | None = None
    pendingActionDecision: Literal["approve", "reject"] | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "AgentChatRequest":
        has_pending_decision = bool(self.pendingActionId) or bool(
            self.pendingActionDecision
        )
        if has_pending_decision:
            if not self.pendingActionId or not self.pendingActionDecision:
                raise ValueError(
                    "pendingActionId and pendingActionDecision must be provided together"
                )
            return self

        if not self.messages:
            raise ValueError(
                "messages must not be empty when no pending action decision is provided"
            )

        return self


class AgentChatResponse(BaseModel):
    reply: str
    model: str
    generatedAt: str
    usedFallback: bool = False
    toolEvents: list[AgentToolEvent] = Field(default_factory=list)
    pendingAction: AgentPendingAction | None = None


class SimulationFailureInput(BaseModel):
    componentId: str = Field(min_length=1)
    mode: str = Field(min_length=1)
    severity: float = Field(default=0.8, ge=0.0, le=1.0)
    startSeconds: float = Field(default=0.0, ge=0.0)
    endSeconds: float | None = Field(default=None, ge=0.0)


class SimulationRunRequest(BaseModel):
    durationSeconds: float = Field(default=600.0, ge=30.0, le=3600.0)
    dtSeconds: float = Field(default=1.0, ge=0.2, le=10.0)
    failures: list[SimulationFailureInput] = Field(default_factory=list)


class SimulationTimelineView(BaseModel):
    timesSeconds: list[float]
    zoneTemperatures: dict[str, list[float]]
    rowTemperatures: dict[str, list[float]]
    zoneColdAisleTemperatures: dict[str, list[float]] = Field(default_factory=dict)
    zoneHotAisleTemperatures: dict[str, list[float]] = Field(default_factory=dict)
    zoneRecirculation: dict[str, list[float]] = Field(default_factory=dict)
    zoneSupplyFlows: dict[str, list[float]]
    zoneExhaustFlows: dict[str, list[float]]
    nodePositionsTimeline: list[dict[str, float]]
    maxCpuTemperature: list[float]
    rackCpuTemperatures: dict[str, list[float]] = Field(default_factory=dict)
    rackInletTemperatures: dict[str, list[float]] = Field(default_factory=dict)
    throttledCpuCount: list[int]
    shutdownCpuCount: list[int]


class BayesianNodeView(BaseModel):
    id: str
    label: str
    layer: str
    kind: str
    probability: float


class BayesianEdgeView(BaseModel):
    source: str
    target: str
    weight: float


class BayesianRiskView(BaseModel):
    id: str
    label: str
    probability: float


class BayesianSummaryView(BaseModel):
    cpu_throttling_probability: float
    service_degradation_probability: float
    most_at_risk_zone: str
    baseline_cpu_throttling_probability: float = 0.0
    baseline_service_degradation_probability: float = 0.0
    cpu_probability_delta: float = 0.0
    service_probability_delta: float = 0.0
    key_drivers: list[str] = Field(default_factory=list)


class BayesianContributionView(BaseModel):
    sourceId: str
    sourceLabel: str
    baselineContribution: float
    candidateContribution: float
    deltaContribution: float


class BayesianPathView(BaseModel):
    path: str
    score: float


class BayesianRiskExplanationView(BaseModel):
    targetId: str
    targetLabel: str
    baselineProbability: float
    candidateProbability: float
    deltaProbability: float
    topContributors: list[BayesianContributionView] = Field(default_factory=list)
    strongestPaths: list[BayesianPathView] = Field(default_factory=list)
    interpretation: str


class BayesianExplainabilityView(BaseModel):
    method: str
    simulationEvidence: dict[str, float] = Field(default_factory=dict)
    cpuRisk: BayesianRiskExplanationView
    serviceRisk: BayesianRiskExplanationView


class BayesianView(BaseModel):
    nodes: list[BayesianNodeView]
    edges: list[BayesianEdgeView]
    topRisks: list[BayesianRiskView]
    summary: BayesianSummaryView
    explainability: BayesianExplainabilityView | None = None


class DiscoveryView(BaseModel):
    focus_zone_id: str
    zone_peak_delta_by_zone: dict[str, float]
    most_impacted_zone_id: str
    max_zone_peak_delta_c: float
    baseline_zone_peak_c: float
    candidate_zone_peak_c: float
    zone_peak_delta_c: float
    baseline_cpu_peak_c: float
    candidate_cpu_peak_c: float
    cpu_peak_delta_c: float
    time_to_first_throttle_baseline_s: float | None = None
    time_to_first_throttle_candidate_s: float | None = None
    time_to_first_shutdown_baseline_s: float | None = None
    time_to_first_shutdown_candidate_s: float | None = None
    discoveryClaim: str | None = None
    counterintuitiveFinding: str | None = None
    significanceScore: float | None = None
    pValue: float | None = None
    effectSize: float | None = None
    confidenceIntervalC: list[float] = Field(default_factory=list)
    primaryImpactZone: str | None = None
    nonLocalImpactC: float | None = None
    compoundHotspotZone: str | None = None
    compoundHotspotRate: float | None = None
    evidence: list[str] = Field(default_factory=list)


class SimulationRunResponse(BaseModel):
    generatedAt: str
    durationSeconds: float
    dtSeconds: float
    timeline: SimulationTimelineView
    discovery: DiscoveryView
    bayesian: BayesianView
    events: list[str]
